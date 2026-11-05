{
  "targets": [{
    "target_name": "fitaddon",
    "sources": ["native/fitaddon.cc", "mpfit.c"],
    "defines": ["NAPI_VERSION=8"],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "xcode_settings": {"GCC_ENABLE_CPP_EXCEPTIONS": "YES", "CLANG_CXX_LANGUAGE_STANDARD": "c++17"},
    "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1}}
  }]
}
