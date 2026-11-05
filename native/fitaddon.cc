// Stable Node-API bridge. MPFIT calls a synchronous JavaScript residual function.
#include <node_api.h>
#include <cmath>
#include <stdexcept>
#include <vector>
#include "../mpfit.h"

static void check(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Node-API conversion failed");
}
static napi_value property(napi_env env, napi_value obj, const char* name) {
  napi_value value; check(napi_get_named_property(env, obj, name, &value)); return value;
}
static double number(napi_env env, napi_value value) {
  double result; check(napi_get_value_double(env, value, &result));
  if (!std::isfinite(result)) throw std::runtime_error("Expected a finite number");
  return result;
}
static napi_value jsNumber(napi_env env, double value) {
  napi_value result; check(napi_create_double(env, value, &result)); return result;
}
static napi_value array(napi_env env, const double* values, size_t size) {
  napi_value result; check(napi_create_array_with_length(env, size, &result));
  for (size_t i=0; i<size; i++) check(napi_set_element(env, result, i, jsNumber(env, values[i])));
  return result;
}
static void set(napi_env env, napi_value obj, const char* name, napi_value value) {
  check(napi_set_named_property(env, obj, name, value));
}
static std::vector<double> numbers(napi_env env, napi_value value) {
  bool isArray; check(napi_is_array(env, value, &isArray));
  if (!isArray) throw std::runtime_error("Expected a numeric array");
  uint32_t length; check(napi_get_array_length(env, value, &length));
  if (length > 100000) throw std::runtime_error("Array too large");
  std::vector<double> result(length);
  for (uint32_t i=0; i<length; i++) {
    napi_value item; check(napi_get_element(env, value, i, &item)); result[i]=number(env,item);
  }
  return result;
}
struct Callback { napi_env env; napi_value fn; bool failed=false; };
static int residuals(int m, int n, double* params, double* values, double**, void* data) {
  auto* callback=static_cast<Callback*>(data);
  napi_handle_scope scope;
  if (napi_open_handle_scope(callback->env,&scope)!=napi_ok) { callback->failed=true; return -1; }
  try {
    napi_value input=array(callback->env,params,n), output, receiver;
    check(napi_get_undefined(callback->env,&receiver));
    check(napi_call_function(callback->env,receiver,callback->fn,1,&input,&output));
    auto result=numbers(callback->env,output);
    if (result.size()!=static_cast<size_t>(m)) throw std::runtime_error("Residual count must match dataLength");
    for (int i=0;i<m;i++) values[i]=result[i];
  } catch (const std::exception& error) {
    callback->failed=true;
    bool pending=false; napi_is_exception_pending(callback->env,&pending);
    if (!pending) napi_throw_error(callback->env,nullptr,error.what());
  }
  napi_close_handle_scope(callback->env,scope);
  return callback->failed ? -1 : 0;
}
static napi_value fit(napi_env env,napi_callback_info info) {
  try {
    size_t argc=2; napi_value argv[2]; check(napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr));
    if (argc!=2) throw std::runtime_error("Expected options and residual function");
    napi_valuetype type; check(napi_typeof(env,argv[1],&type));
    if (type!=napi_function) throw std::runtime_error("Residual function required");
    auto params=numbers(env,property(env,argv[0],"initialValues"));
    auto fixed=numbers(env,property(env,argv[0],"fixed"));
    auto lower=numbers(env,property(env,argv[0],"minValues"));
    auto upper=numbers(env,property(env,argv[0],"maxValues"));
    size_t n=params.size();
    if (!n || n>100 || fixed.size()!=n || lower.size()!=n || upper.size()!=n)
      throw std::runtime_error("Parameter arrays must have equal lengths between 1 and 100");
    double count=number(env,property(env,argv[0],"dataLength"));
    if (count<1 || count>100000 || count!=std::floor(count)) throw std::runtime_error("Invalid dataLength");
    std::vector<mp_par> constraints(n);
    for (size_t i=0;i<n;i++) {
      constraints[i].fixed=fixed[i]!=0;
      constraints[i].limited[0]=constraints[i].limited[1]=1;
      constraints[i].limits[0]=lower[i]; constraints[i].limits[1]=upper[i];
      constraints[i].side=2;
    }
    std::vector<double> errors(n),covariance(n*n);
    mp_result result={}; result.xerror=errors.data(); result.covar=covariance.data();
    mp_config config={}; config.maxiter=500; config.maxfev=10000;
    Callback callback={env,argv[1]};
    int status=mpfit(residuals,static_cast<int>(count),static_cast<int>(n),params.data(),constraints.data(),&config,&callback,&result);
    if (callback.failed) return nullptr;
    napi_value output; check(napi_create_object(env,&output));
    set(env,output,"parameterValues",array(env,params.data(),n));
    set(env,output,"errors",array(env,errors.data(),n));
    set(env,output,"covariance",array(env,covariance.data(),n*n));
    set(env,output,"status",jsNumber(env,status));
    set(env,output,"chi2",jsNumber(env,result.bestnorm));
    set(env,output,"dof",jsNumber(env,result.nfunc-result.nfree));
    set(env,output,"iterations",jsNumber(env,result.niter));
    set(env,output,"pegged",jsNumber(env,result.npegged));
    return output;
  } catch (const std::exception& error) {
    bool pending=false; napi_is_exception_pending(env,&pending);
    if (!pending) napi_throw_error(env,nullptr,error.what());
    return nullptr;
  }
}
static napi_value init(napi_env env,napi_value exports) {
  napi_value fn; if (napi_create_function(env,"fit",NAPI_AUTO_LENGTH,fit,nullptr,&fn)!=napi_ok) return nullptr;
  napi_set_named_property(env,exports,"fit",fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
