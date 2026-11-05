const DEFAULT_T0_ERR_NS = 10;
let warnedAboutT0Mismatch = false;

const DEFAULT_B_ERR_NS = 1;
let warnedAboutBMismatch = false;


const githubFooter = document.getElementById("githubFooter");
if(githubFooter && !runningInElectron()){
  githubFooter.style.display = "block";
}

var ukeV = 931494.10372;
var eMasskeV = 510.99895069;
var NUBASE = new Array();
var nubaseByNuclide = new Map();

var t0withErr = {val: 125, err: 10};
var bwithErr = {val: 26497, err: 1};
NUBASE = loadNUBASE();
var periodicData = getChart(document.getElementById("divPeriodicTable"));

var logoIMG = document.getElementById("logo");
logoIMG.addEventListener("click", function(){alert("Nice aim!")}, false);
logoIMG.style.position = 'absolute';
logoIMG.style.height = '25px';
logoIMG.style.top = '23px';
logoIMG.style.left="200px";
var position = 200;
var direction = 1;
setInterval(function(){
  position = position + direction;
  logoIMG.style.left=String(position).concat("","px");
  if(position==425 || position == 25) direction *= -1;
}, 10, false);

document.getElementById("ref1Laps").isInteger = true;
document.getElementById("ref1Laps").onkeydown = function(e){
  if (e.metaKey || e.ctrlKey) {
    this.badKey = false;
    return true;
  }
  var regex=/^[0-9]+$/;
  var theKey = String(e.key);
  if( (theKey.length) == 1 && !(theKey.match(regex)) ){
    this.badKey = true;
    return false;
  }
  else this.badKey = false;
}
document.getElementById("ref1Laps").addEventListener("keydown", chkValue, false);

document.getElementById("ToF_Ref1").isInteger = false;
document.getElementById("ToF_Ref1").onkeydown = function(e){
  if (e.metaKey || e.ctrlKey) {
    this.badKey = false;
    return true;
  }
  var regex=/^[0-9]+$/;
  var theKey = String(e.key);
  if( (theKey.length) == 1 && !(theKey.match(regex)) ){
    if(theKey == '.'){
      var intAndDecimal = String(this.value);
      var parts = new Array();
      parts = intAndDecimal.split(".");
      if(parts.length <= 1) this.badKey = false; //If there is no decimal point yet, allow it
      else{
        this.badKey = true;
        return false;       
      }
    }
    else{
      this.badKey = true;
      return false;
    }
  }
  else this.badKey = false;
}
document.getElementById("ToF_Ref1").addEventListener("keydown", chkValue, false);

document.getElementById("ToF_Ref1err").isInteger = false;
document.getElementById("ToF_Ref1err").onkeydown = function(e){
  var regex=/^[0-9]+$/;
  var theKey = String(e.key);
  if( (theKey.length) == 1 && !(theKey.match(regex)) ){
    if(theKey == '.'){
      var intAndDecimal = String(this.value);
      var parts = new Array();
      parts = intAndDecimal.split(".");
      if(parts.length <= 1) this.badKey = false; //If there is no decimal point yet, allow it
      else{
        this.badKey = true;
        return false;       
      }
    }
    else{
      this.badKey = true;
      return false;
    }
  }
  else this.badKey = false;
}
document.getElementById("ToF_Ref1err").addEventListener("keydown", chkValue, false);

btn_bCalc = document.getElementById("btn_bCalc");
  btn_bCalc.addEventListener("click", makebCalc, false);

btn_t0Calc = document.getElementById("btn_t0Calc");
  btn_t0Calc.addEventListener("click", maket0Calc, false);

btn_CalcToF = document.getElementById("btn_ToFCalc");
  btn_CalcToF.addEventListener("click", calcToF, false);

btn_CalcMass = document.getElementById("btn_MECalc");
  btn_CalcMass.addEventListener("click", calcMass, false);

btnSelectNone = document.getElementById("btnSelectNone");
  btnSelectNone.addEventListener("click", fnSelectNone, false);

btnStandardSelection = document.getElementById("btnSelectStandardSet");
  btnStandardSelection.addEventListener("click", fnStandardSelection, false);

btnFindSCM = document.getElementById("btnFindSCM");
  btnFindSCM.addEventListener("click", fnFindSCM, false);

//----------------------------------------------------
function showSCMHeaderMenu(x, y) {
  let menu = document.getElementById("SCMHeaderContextMenu");

  if(!menu){
    menu = document.createElement("div");
    menu.id = "SCMHeaderContextMenu";
    menu.style.position = "fixed";
    menu.style.zIndex = "9999";
    menu.style.background = "white";
    menu.style.border = "1px solid #555";
    menu.style.padding = "4px";
    menu.style.fontFamily = "Arial, Helvetica, sans-serif";
    menu.style.fontSize = "12px";
    menu.style.boxShadow = "2px 2px 6px rgba(0,0,0,0.25)";

    const saveText = document.createElement("div");
    saveText.textContent = "Save table to text file";
    saveText.style.padding = "4px 10px";
    saveText.onclick = () => {
      const csv = makeSCMTableCSV();

      if(csv.trim() === ""){
        alert("No table data to save.");
        hideSCMHeaderMenu();
        return;
      }

      downloadTextFile("ufo_finder_results.csv", csv);
      hideSCMHeaderMenu();
    };

    const copyText = document.createElement("div");
    copyText.textContent = "Copy table to clipboard";
    copyText.style.padding = "4px 10px";
    copyText.onclick = async () => {
      const csv = makeSCMTableCSV();

      if(csv.trim() === ""){
        alert("No table data to copy.");
        hideSCMHeaderMenu();
        return;
      }

      try {
        await navigator.clipboard.writeText(csv);
        alert("UFO finder table copied to clipboard.");
      } catch(err) {
        console.error(err);
        alert("Could not copy table to clipboard.");
      }

      hideSCMHeaderMenu();
    };

    menu.appendChild(saveText);
    menu.appendChild(copyText);
    document.body.appendChild(menu);
  }

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = "block";
}

function hideSCMHeaderMenu() {
  const menu = document.getElementById("SCMHeaderContextMenu");
  if(menu) menu.style.display = "none";
}

const scmHeader = document.querySelector("#SCMTable thead");
if(scmHeader){
  scmHeader.addEventListener("click", function(e){
    e.preventDefault();
    showSCMHeaderMenu(e.clientX, e.clientY);
  });

  scmHeader.addEventListener("contextmenu", function(e){
    e.preventDefault();
    showSCMHeaderMenu(e.clientX, e.clientY);
  });
}

document.addEventListener("click", function(e){
  const menu = document.getElementById("SCMHeaderContextMenu");
  if(menu && !menu.contains(e.target) && !e.target.closest("#SCMTable thead")){
    hideSCMHeaderMenu();
  }
});
//----------------------------------------------------

document.addEventListener("copy", function(e) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const node = selection.anchorNode;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  const moleculeCell = element.closest("#SCMTable td:nth-child(1)");

  if (moleculeCell && moleculeCell.dataset.copyText) {
    e.preventDefault();
    e.clipboardData.setData("text/plain", moleculeCell.dataset.copyText);
  }
});

if (window.electronAPI && window.electronAPI.onMenuClearT0) {
  window.electronAPI.onMenuClearT0((value) => {
      t0withErr = {val: 125, err: 0};
      document.getElementById("lblCalct0").innerHTML = "...";
      document.getElementById("t0").value = 125;
      console.log(periodicData);
      console.log(periodicData.length);
    });
}
 
//----------------------------------------------------    
function chkValue(e){

  if(e.key != "ArrowRight" && e.key != "ArrowLeft" && e.key != "Tab"){
    if(!this.badKey === true){
      this.style.backgroundColor = "white"; //set back to yellow if change highlighting is desired
      this.hasChanged = "true";
      this.oldValue = this.value;
    }
  }
  if(e.key == "ArrowRight"){
    //Prevent cursor from reaching end or from sitting just left of the decimal
    caretPos = this.selectionStart;
    thisValue = this.value;
  }
  if(e.key == "ArrowLeft"){
    //Prevent cursor from sitting just left of decimal or left of negative sign 
    caretPos = this.selectionStart;
    thisValue = this.value;
  }
  if(e.key == "ArrowDown" || e.key == 40 || e.key == "ArrowUp" || e.key == 38){ 
    caretPos = this.selectionStart;
    var theValue = this.value;
    //Find location of decimal point in theValue
    //Increment size depends on caret position relative to decimal
    //If caret is left of decimal we increment the power to the left of caret
    //If caret is to the right of decimal we increment the power to the right of caret
    var decimalPos = theValue.indexOf(".");
    decimalPos = String(theValue).length;
    var increment = 10**(decimalPos-caretPos);
    if(caretPos < decimalPos) increment /= 10;
    var newValue;
    if(e.key == "ArrowUp" || e.key == 38){ 
      newValue = parseFloat(this.value) + increment;
    }
    else if(e.key == "ArrowDown" || e.key == 40){ 
      newValue = parseFloat(this.value) - increment;
    }
    if(parseFloat(this.value) < 0) newValue = 1;
    if(this.isInteger)  this.value = newValue.toFixed(0);
    else this.value = newValue;

    //The following code prevents wierd caret behaviour
    e.preventDefault();
    this.blur();
    this.selectionStart = caretPos;
    this.selectionEnd = caretPos;
    this.focus();
    
  }
  if(e.keyCode == 13){ 
    this.style.backgroundColor = "white";
  }
}
//----------------------------------------------------    

function makebCalc() {

var theNuclide1 = document.getElementById("NameRef1");
var theCharge1 = parseFloat(document.getElementById("selCharge1").value);
var theMass1 = getMass(theNuclide1.value, theCharge1);
document.getElementById("Mass1").innerHTML = String(theMass1).concat("", " u");

var theNuclide2 = document.getElementById("NameRef2");
var theCharge2 = parseFloat(document.getElementById("selCharge2").value);
var theMass2 = getMass(theNuclide2.value, theCharge2);
document.getElementById("Mass2").innerHTML = String(theMass2).concat("", " u");

var mOverQ1 = theMass1/theCharge1;
var mOverQ2 = theMass2/theCharge2;

const t0 = parseFloat(document.getElementById("t0").value);;
var ref1Laps = parseFloat(document.getElementById("ref1Laps").value);
var ref2Laps = parseFloat(document.getElementById("ref2Laps").value);

var ok = true;

if(document.getElementById("ToF_Ref1").value == "") ok = false;
if(document.getElementById("ToF_Ref2").value == "") ok = false;
if(!ok) alert("Missing at least one ToF value!");

if(document.getElementById("ref1Laps").value == ""){
  alert("We need to know the lap number of reference 1, sorry.");
  ok = false;
}
if(ok){
  if(document.getElementById("ref2Laps").value == ""){
//    console.log("Looking for laps of reference 2");
    if(document.getElementById("bEstimate").value == ""){
      alert("Give us even a rough estimate of the b-value for reference 1");
      ok = false;
    }
    else{
      var bEstimate = parseFloat(document.getElementById("bEstimate").value);
      var nRef1 = parseFloat(document.getElementById("ref1Laps").value);
      if(document.getElementById("Ref2EjTime").value == ""){
        var ref1tAtN0 = parseFloat(document.getElementById("ToF_Ref1").value) - nRef1*bEstimate;
        var ref2tAtN0 = ref1tAtN0*Math.sqrt(mOverQ2/mOverQ1);
        ref2Laps = (parseFloat(document.getElementById("ToF_Ref2").value) - ref2tAtN0)/(bEstimate*Math.sqrt(mOverQ2/mOverQ1));
        document.getElementById("ref2Laps").value = parseInt(ref2Laps);
      }
      else{
        var tej2 = parseFloat(document.getElementById("Ref2EjTime").value);
        var ref1tAtN0 = parseFloat(document.getElementById("ToF_Ref1").value) - nRef1*bEstimate;
        var ref2tAtN0 = ref1tAtN0*Math.sqrt(mOverQ2/mOverQ1);
        ref2Laps = (tej2 - ref2tAtN0)/(bEstimate*Math.sqrt(mOverQ2/mOverQ1));
        document.getElementById("ref2Laps").value = parseInt(ref2Laps);
      } 
    }
  }
}

ref2Laps = parseFloat(document.getElementById("ref2Laps").value);
var DeltaN = parseInt(ref1Laps) - parseInt(ref2Laps);
if(DeltaN == 0){ 
  alert("Requires Δn≠0!");
  ok = false;
}

if(ok){
  var ToFRef1 = parseFloat(document.getElementById("ToF_Ref1").value) - t0;
  var ToFRef1Err = parseFloat(document.getElementById("ToF_Ref1err").value);
  var ToFRef2 = parseFloat(document.getElementById("ToF_Ref2").value) - t0;
  var ToFRef2Err = parseFloat(document.getElementById("ToF_Ref2err").value);
/*
  console.log("The tof for Ref1 is ", ToFRef1);
  console.log("The tof for Ref2 is ", ToFRef2*Math.sqrt(mOverQ1/mOverQ2));
  console.log("The tof difference is ", ToFRef2*Math.sqrt(mOverQ1/mOverQ2) - ToFRef1);
*/
  var bvalue = (ToFRef2*Math.sqrt(mOverQ1/mOverQ2) - ToFRef1)/(ref2Laps - ref1Laps);
  var theLabel = document.getElementById("lblb");
  var DeltaToFErr = Math.sqrt(ToFRef2Err*ToFRef2Err*(mOverQ1/mOverQ2) + ToFRef1Err*ToFRef1Err)/DeltaN;

/*
  bwithErr = {val: bvalue.toFixed(4), err: DeltaToFErr.toFixed(4)}
  document.getElementById("bEstimate").value = String(bvalue.toFixed(2));
  theLabel.innerHTML = String(bvalue.toFixed(2)).concat(" ± ", DeltaToFErr.toFixed(2));
*/
  bwithErr = {
    val: bvalue,
    err: DeltaToFErr
  };

  document.getElementById("bEstimate").value = bvalue.toFixed(2);
  theLabel.innerHTML = `${bvalue.toFixed(2)} ± ${DeltaToFErr.toFixed(2)}`;

  warnedAboutBMismatch = false;
} 
}
//----------------------------------------------------    

function maket0Calc() {

    var theNuclide1 = document.getElementById("NameRef1");
    var theCharge1 = parseFloat(document.getElementById("selCharge1").value);
    var theMass1 = getMass(theNuclide1.value, theCharge1);
    document.getElementById("Mass1").innerHTML = String(theMass1).concat("", " u");

    var theNuclide2 = document.getElementById("NameRef2");
    var theCharge2 = parseFloat(document.getElementById("selCharge2").value);
    var theMass2 = getMass(theNuclide2.value, theCharge2);
    document.getElementById("Mass2").innerHTML = String(theMass2).concat("", " u");

    var mOverQ1 = theMass1/theCharge1;
    var mOverQ2 = theMass2/theCharge2;

    const t0 = parseFloat(document.getElementById("t0").value);;

    var ref1Laps = parseFloat(document.getElementById("ref1Laps").value);
    var ref2Laps = parseFloat(document.getElementById("ref2Laps").value);
    var DeltaN = parseInt(ref1Laps) - parseInt(ref2Laps);

    if(DeltaN != 0) alert("Requires Δn=0!");
    else{

        var ToFRef1 = parseFloat(document.getElementById("ToF_Ref1").value);
        var ToFRef1Err = parseFloat(document.getElementById("ToF_Ref1err").value);
        var ToFRef2 = parseFloat(document.getElementById("ToF_Ref2").value);
        var ToFRef2Err = parseFloat(document.getElementById("ToF_Ref2err").value);
        var massRatio = Math.sqrt(mOverQ1/mOverQ2);

        var t0value = (massRatio*ToFRef2-ToFRef1)/(massRatio-1);
/*
        console.log("The tof for Ref1 is ", ToFRef1);
        console.log("The tof for 41 is ", ToFRef2);
        console.log("The mass ratio is ", massRatio);
*/
        var theLabel = document.getElementById("lblCalct0");
        var T0Err = Math.sqrt(ToFRef2Err*ToFRef2Err*(mOverQ1/mOverQ2) + ToFRef1Err*ToFRef1Err)/Math.abs(massRatio-1);
/*
        t0withErr = {val: t0value.toFixed(2), err: T0Err.toFixed(2)};
        theLabel.innerHTML = String(t0value.toFixed(2)).concat(" ± ", T0Err.toFixed(2));
*/
        t0withErr = {
          val: t0value,
          err: T0Err
        };

        document.getElementById("t0").value = t0value.toFixed(2);
        theLabel.innerHTML = `${t0value.toFixed(2)} ± ${T0Err.toFixed(2)}`;

        warnedAboutT0Mismatch = false;
    } 
}

function calcToF() {

var theNuclide1 = document.getElementById("NameRef1");
var theCharge1 = parseFloat(document.getElementById("selCharge1").value);
var theMass1 = getMass(theNuclide1.value, theCharge1);
document.getElementById("Mass1").innerHTML = String(theMass1).concat("", " u");

var theNuclide2 = document.getElementById("NameAnalyte");
var theCharge2 = parseFloat(document.getElementById("selChargeAna").value);
var theMass2 = getMass(theNuclide2.value, theCharge2);
document.getElementById("MassAna").innerHTML = String(theMass2).concat("", " u");

var mOverQ1 = theMass1/theCharge1;
var mOverQ2 = theMass2/theCharge2;

var ref1Laps = parseFloat(document.getElementById("ref1Laps").value);
var analyteLaps = parseFloat(document.getElementById("AnalyteLaps").value);
var DeltaN = parseInt(ref1Laps) - parseInt(analyteLaps);
var tof1 = parseFloat(document.getElementById("ToF_Ref1").value);
var ToFRef1Err = parseFloat(document.getElementById("ToF_Ref1err").value);
var ref1ToF = {val: tof1,
              err: ToFRef1Err};
if(isNaN(ref1ToF.err)) ref1ToF.err = 0;           

var ok = true;
var t0Calc = getT0ForCalculation();
if(t0Calc == null) ok = false;
if(isNaN(ref1Laps) || document.getElementById("ref1Laps").value == ""){
  alert("We need to know how many laps Reference 1 made!");
  ok = false;
}
if(isNaN(ref1ToF.val) || document.getElementById("ToF_Ref1").value == ""){
  console.log(document.getElementById("ToF_Ref1"));
  alert("We need a ToF for reference 1!");
  ok = false;
}
if(theNuclide2 == ""){
  alert("We need a name for the analyte ion!");
  ok = false;
}
if(ok){
  if(document.getElementById("AnalyteLaps").value != ""){
    if(ref1Laps == analyteLaps){
      var analyteToF = (ref1ToF.val - t0Calc.val)*Math.sqrt(mOverQ2/mOverQ1) + t0Calc.val;
      var analyteToFErr = (ref1ToF.err/ref1ToF.val)*analyteToF;
      document.getElementById("ToF_Analyte").value = String(analyteToF.toFixed(2));
      document.getElementById("ToF_AnalyteErr").value = analyteToFErr.toFixed(2);
    }
    else{
/*
      if(bwithErr.err == 0){
        if(document.getElementById("bEstimate").value == ""){
          alert("We need a b-value for reference 1!");
          ok = false;
        }
        else bwithErr.val = parseFloat(document.getElementById("bEstimate").value);
      }
*/
      var bCalc = getBForCalculation();
      if(bCalc == null) ok = false;
      var analyteToF = (ref1ToF.val - t0Calc.val)*Math.sqrt(mOverQ2/mOverQ1) + t0Calc.val;
      var analyteB = {val: bCalc.val*Math.sqrt(mOverQ2/mOverQ1), err: bCalc.err*Math.sqrt(mOverQ2/mOverQ1)};
      var DeltaN = parseInt(analyteLaps) - parseInt(ref1Laps);
      analyteToF += DeltaN*analyteB.val;
      var analyteToFErr = Math.sqrt( (ref1ToF.err/ref1ToF.val)*analyteToF*(ref1ToF.err/ref1ToF.val)*analyteToF + DeltaN*analyteB.err*DeltaN*analyteB.err);
      document.getElementById("ToF_Analyte").value = String(analyteToF.toFixed(2));
      document.getElementById("ToF_AnalyteErr").value = analyteToFErr.toFixed(2);
    }
  }
  else if(document.getElementById("AnalyteEjTime").value == ""){//Assume same laps as ref1
    var analyteToF = (ref1ToF.val - t0Calc.val)*Math.sqrt(mOverQ2/mOverQ1) + t0Calc.val;
    var analyteToFErr = (ref1ToF.err/ref1ToF.val)*analyteToF;
    document.getElementById("ToF_Analyte").value = String(analyteToF.toFixed(2));
    document.getElementById("ToF_AnalyteErr").value = analyteToFErr.toFixed(2);
    document.getElementById("AnalyteLaps").value = document.getElementById("ref1Laps").value;
  }
  else{ //We have the ejection time, so we can calculate the lap number with a b-value
/*
    if(bwithErr.err == 0){
      if(document.getElementById("bEstimate").value == ""){
        alert("We need a b-value for reference 1!");
        ok = false;
      }
      else bwithErr.val = parseFloat(document.getElementById("bEstimate").value);
    }
*/
    var bCalc = getBForCalculation();
    if(bCalc == null) ok = false;
    if(ok){
      var tejAnalyte = parseFloat(document.getElementById("AnalyteEjTime").value);
      var ref1tAtN0 = parseFloat(document.getElementById("ToF_Ref1").value) - ref1Laps*bCalc.val;
      var AnalytetAtN0 = ref1tAtN0*Math.sqrt(mOverQ2/mOverQ1) - t0Calc.val;
      analyteLaps = Math.ceil((tejAnalyte - AnalytetAtN0)/(bCalc.val*Math.sqrt(mOverQ2/mOverQ1)));
      document.getElementById("AnalyteLaps").value = analyteLaps;

      var analyteToF = (ref1ToF.val - t0Calc.val)*Math.sqrt(mOverQ2/mOverQ1) + t0Calc.val;
      var analyteB = {val: bCalc.val*Math.sqrt(mOverQ2/mOverQ1), err: bCalc.err*Math.sqrt(mOverQ2/mOverQ1)};
      var DeltaN = parseInt(analyteLaps) - parseInt(ref1Laps);
      analyteToF += DeltaN*analyteB.val;
      var analyteToFErr = Math.sqrt( (ref1ToF.err/ref1ToF.val)*analyteToF*(ref1ToF.err/ref1ToF.val)*analyteToF + DeltaN*analyteB.err*DeltaN*analyteB.err);
      document.getElementById("ToF_Analyte").value = String(analyteToF.toFixed(2));
      document.getElementById("ToF_AnalyteErr").value = analyteToFErr.toFixed(2);
    }
  }
}
}

//----------------------------------------------------  
function calcMass(){
var ok = true;
var ref1Laps = parseFloat(document.getElementById("ref1Laps").value);
var AnalyteLaps = parseFloat(document.getElementById("AnalyteLaps").value);
var ref1ToF = {val: parseFloat(document.getElementById("ToF_Ref1").value), err: parseFloat(document.getElementById("ToF_Ref1err").value)};
var analyteToF = {val: parseFloat(document.getElementById("ToF_Analyte").value), err: parseFloat(document.getElementById("ToF_AnalyteErr").value)};
var theNuclide1 = document.getElementById("NameRef1");
var theNuclide2 = document.getElementById("NameAnalyte");

if(isNaN(ref1Laps) || document.getElementById("ref1Laps").value == ""){
  alert("We need to know how many laps Reference 1 made!");
  ok = false;
}
if(ok) if(isNaN(ref1ToF.val) || document.getElementById("ToF_Ref1").value == ""){
  console.log(document.getElementById("ToF_Ref1"));
  alert("We need a ToF for reference 1!");
  ok = false;
}
if(ok) if(isNaN(analyteToF.val) || document.getElementById("ToF_Analyte").value == ""){
  console.log(document.getElementById("ToF_Analyte"));
  alert("We need a ToF for the analyte!");
  ok = false;
}
if(ok) if(theNuclide1.value == ""){
  alert("We need a name for the reference ion!");
  ok = false;
}
if(ok) if(theNuclide2.value == ""){
  alert("We need a name for the analyte ion!");
  ok = false;
}
if(ok) if(ref1Laps !== AnalyteLaps){
/*
  if(bwithErr.err == 0){
    if(document.getElementById("bEstimate").value == ""){
      alert("We need a b-value for reference 1!");
      ok = false;
    }
    else bwithErr.val = parseFloat(document.getElementById("bEstimate").value);
  }
*/
  var bCalc = getBForCalculation();
  if(bCalc == null) ok = false;
}
/*
if(ok) if(t0withErr.err == 0){
  if(document.getElementById("t0").value == ""){
    alert("We will need a t_0 value to calculate things...");
    ok = false;
  }
  else t0withErr.val = parseFloat(document.getElementById("t0").value);
}
*/
var t0Calc = getT0ForCalculation();
if(t0Calc == null) ok = false;
if(ok) ok = checkFormula(theNuclide1.value);
if(ok) ok = checkFormula(theNuclide2.value);
if(ok) if(isNaN(AnalyteLaps) || document.getElementById("AnalyteLaps").value == ""){
  if(document.getElementById("AnalyteEjTime").value == ""){
    alert("We need to know how many laps the analyte made. Tell us that or the analyte's ejection time!");
    ok = false;
  }
  else{//calculate AnalyteLaps
    var theCharge1 = parseFloat(document.getElementById("selCharge1").value);
    var theMass1 = getMass(theNuclide1.value, theCharge1);
    document.getElementById("Mass1").innerHTML = String(theMass1).concat("", " u");

    var theCharge2 = parseFloat(document.getElementById("selChargeAna").value);
    var theMass2 = getMass(theNuclide2.value, theCharge2);
    document.getElementById("MassAna").innerHTML = String(theMass2).concat("", " u");

    var mOverQ1 = theMass1/theCharge1;
    var mOverQ2 = theMass2/theCharge2;
    var tejAnalyte = parseFloat(document.getElementById("AnalyteEjTime").value);
    var ref1tAtN0 = parseFloat(document.getElementById("ToF_Ref1").value) - ref1Laps*bCalc.val;
    var AnalytetAtN0 = ref1tAtN0*Math.sqrt(mOverQ2/mOverQ1) - t0Calc.val;
    AnalyteLaps = Math.ceil((tejAnalyte - AnalytetAtN0)/(bCalc.val*Math.sqrt(mOverQ2/mOverQ1)));
    document.getElementById("AnalyteLaps").value = AnalyteLaps;
  }
}

if(ok){
  var theCharge1 = parseFloat(document.getElementById("selCharge1").value);
  var theMass1 = getMass(theNuclide1.value, theCharge1);
  document.getElementById("Mass1").innerHTML = String(theMass1).concat("", " u");

  var theCharge2 = parseFloat(document.getElementById("selChargeAna").value);
  var theMass2 = getMass(theNuclide2.value, theCharge2);
  document.getElementById("MassAna").innerHTML = String(theMass2).concat("", " u");

  var mOverQ1 = theMass1/theCharge1;
  var mOverQ2 = theMass2/theCharge2;

  if(ref1Laps == AnalyteLaps){
    var rho = (analyteToF.val - t0Calc.val)/(ref1ToF.val - t0Calc.val);
    var m = theCharge2*mOverQ1*rho*rho;
    var MassExcess = (m - Math.round(theMass2))*ukeV + theCharge2*eMasskeV;
    var dMassExcess = 2*m*Math.sqrt((analyteToF.err/analyteToF.val)*(analyteToF.err/analyteToF.val) + (ref1ToF.err/ref1ToF.val)*(ref1ToF.err/ref1ToF.val))*ukeV;
//add term for dt_0
    var DMassExcess = (m - theMass2)*ukeV;
    document.getElementById("lblMassExcess").innerHTML = String("ME=").concat(MassExcess.toFixed(2)," keV");
    document.getElementById("lbldM").innerHTML = String("δME=").concat(dMassExcess.toFixed(2)," keV");
    document.getElementById("lblDM").innerHTML = String("Δm=").concat(DMassExcess.toFixed(2)," keV");
  }
  else{
    var DeltaN = AnalyteLaps - ref1Laps;
    ref1ToF.val += DeltaN*bCalc.val;
    ref1ToF.err += Math.abs(DeltaN)*bCalc.err;
//    console.log("AnalyteToF is ", analyteToF);
    var rho = (analyteToF.val - t0Calc.val)/(ref1ToF.val - t0Calc.val);
    var m = theCharge2*mOverQ1*rho*rho;
    var MassExcess = (m - Math.round(theMass2))*ukeV + theCharge2*eMasskeV;
    var dMassExcess = 2*m*Math.sqrt((analyteToF.err/analyteToF.val)*(analyteToF.err/analyteToF.val) + (ref1ToF.err/ref1ToF.val)*(ref1ToF.err/ref1ToF.val))*ukeV;
//add term for dt_0
    var DMassExcess = (m - theMass2)*ukeV;
    document.getElementById("lblMassExcess").innerHTML = String("ME=").concat(MassExcess.toFixed(2)," keV");
    document.getElementById("lbldM").innerHTML = String("δME=").concat(dMassExcess.toFixed(2)," keV");
    document.getElementById("lblDM").innerHTML = String("Δm=").concat(DMassExcess.toFixed(2)," keV");
  }
}
}

//----------------------------------------------------  
function checkFormula(thisNuclide, charge){
  var isValid = true;
//  alert(thisNuclide);

  var theNuclides = thisNuclide.split(/;|:/);
  var theAtoms = new Array();
  for(let i=0; i<theNuclides.length; i++){
    const thisPart = theNuclides.at(i);
    for(let j=0; j<thisPart.length; j++){
      var thisChar = thisPart.at(j);
      if(!(thisChar >= '0' && thisChar <= '9')){ 
        var theNuclide = thisPart.slice(j, thisPart.length);
        var theNumber = thisPart.slice(0, j);
        if(j == 0) theNumber = 1;
        theAtoms.push({nuclide: theNuclide, theNumber: theNumber});
        j=thisPart.length;
      }
    }
  }

  if(theAtoms.length == 0) isValid = false;
  if(isValid){
    var theMass = 0;
    for(let i=0; i<theAtoms.length; i++){
//      var theJSON = NUBASE.find(({nuclide}) => nuclide === theAtoms.at(i).nuclide);
      var theJSON = nubaseByNuclide.get(theAtoms.at(i).nuclide);
      if (typeof theJSON === 'undefined') isValid = false;
      var n= parseFloat(theAtoms.at(i).theNumber);
      theMass += n*(theJSON.A*ukeV + theJSON.MassExcess);
    }
  }

  // alert(thisNuclide);
  if(isValid != true) alert("bad formula");
  return isValid;
}

//----------------------------------------------------  
function getMass(thisNuclide, charge){
//    console.log(thisNuclide);
//    console.log(charge);

  var theNuclides = thisNuclide.split(/;|:/);
  var theAtoms = new Array();
  for(let i=0; i<theNuclides.length; i++){
    const thisPart = theNuclides.at(i);
    for(let j=0; j<thisPart.length; j++){
      var thisChar = thisPart.at(j);
      if(!(thisChar >= '0' && thisChar <= '9')){ 
        var theNuclide = thisPart.slice(j, thisPart.length);
        var theNumber = thisPart.slice(0, j);
        if(j == 0) theNumber = 1;
        theAtoms.push({nuclide: theNuclide, theNumber: theNumber});
        j=thisPart.length;
      }
    }
  }
//    console.log(theAtoms);

  var theMass = 0;
  for(let i=0; i<theAtoms.length; i++){
//    var theJSON = NUBASE.find(({nuclide}) => nuclide === theAtoms.at(i).nuclide);
    var theJSON = nubaseByNuclide.get(theAtoms.at(i).nuclide);
//    if (typeof theJSON !== 'undefined') console.log(theJSON);
    var n= parseFloat(theAtoms.at(i).theNumber);
    theMass += n*(theJSON.A*ukeV + theJSON.MassExcess);
  }
  theMass -= parseFloat(charge)*eMasskeV;
  theMass /= ukeV;
//  console.log(theMass);
  return parseFloat(String(theMass)).toFixed(9);
}

//----------------------------------------------------  
function getMarkup(thisNuclide, charge){
  
    var theNuclides = thisNuclide.split(/;|:/);
    var theAtoms = new Array();
    for(let i=0; i<theNuclides.length; i++){
      const thisPart = theNuclides.at(i);
      for(let j=0; j<thisPart.length; j++){
        var thisChar = thisPart.at(j);
        if(!(thisChar >= '0' && thisChar <= '9')){ 
          var theNuclide = thisPart.slice(j, thisPart.length);
          var theNumber = thisPart.slice(0, j);
          if(j == 0) theNumber = 1;
          theAtoms.push({nuclide: theNuclide, theNumber: theNumber});
          j=thisPart.length;
        }
      }
    }
  
    var theMass = 0;
    var theMarkup ="";
    for(let i=0; i<theAtoms.length; i++){
      var theJSON = nubaseByNuclide.get(theAtoms.at(i).nuclide);
      var n= parseFloat(theAtoms.at(i).theNumber);
//      var theAtom ="<sup>".concat(theJSON.A,"</sup>").concat("",theJSON.element);
      let massLabel = String(theJSON.A);

      if(theJSON.state && theJSON.state.trim() !== ""){
        massLabel += theJSON.state.trim();
      }

      var theAtom =
        "<sup>" + massLabel + "</sup>" +
        theJSON.element;

      if(n>1) theAtom = theAtom.concat("<sub>", n).concat("", "</sub>");
      theMarkup = theMarkup.concat("", theAtom);// "<sup>".concat(theJSON.A,"</sup>").concat(theJSON.element,"<sub>").concat(n, "</sub>"));
    }
//    console.log(charge);
    if(charge == "1") theMarkup = theMarkup.concat("", "<sup>+</sup>");
    else if(charge == 2) theMarkup = theMarkup.concat("", "<sup>2+</sup>");
    else if(charge == 3) theMarkup = theMarkup.concat("", "<sup>3+</sup>");

    return theMarkup;
  }
  
//----------------------------------------------------
function parseIsotopicAbundance(brText) {
  const match = String(brText).match(/IS=([0-9.]+)/);
  return match ? parseFloat(match[1]) : 0;
}
//----------------------------------------------------  

function finalParse(theJSON){
  //Get the element name correct with no spaces
  var firstLetterPosition;
  for(let i=0; i<theJSON.nuclide.length; i++){
    var thisChar = theJSON.nuclide.at(i);
    if(!(thisChar >= '0' && thisChar <= '9')){ 
      theJSON.element = theJSON.nuclide.slice(i, theJSON.nuclide.length);
      i=theJSON.nuclide.length;
    }
  }
  for(let i=0; i<theJSON.element.length; i++){
    var thisChar = theJSON.element.at(i);
    if(thisChar == ' '){
      theJSON.element = theJSON.element.slice(0, i);
      i = theJSON.element.length;
    }
  }

  //Strip extraneous zeroes from Z
  if(theJSON.Z.at(0) == '0'){
    for(let i=0; i<theJSON.Z.length; i++){
      var thisChar = theJSON.Z.at(i);
      if(!(thisChar == '0')){
        theJSON.Z = theJSON.Z.slice(i, theJSON.Z.length);
        i=theJSON.Z.length;
      }
    }
  }
  theJSON.Z = parseInt(theJSON.Z);

  //Get the nulcide name correct with number after letters, convert A to int
  if(theJSON.A.at(0) == '0'){
    for(let i=0; i<theJSON.A.length; i++){
      var thisChar = theJSON.A.at(i);
      if(!(thisChar == '0')){
        theJSON.A = theJSON.A.slice(i, theJSON.A.length);
        i=theJSON.A.length;
      }
    }
    theJSON.nuclide = theJSON.element.concat("", theJSON.A);
    theJSON.A = parseInt(theJSON.A);
  }
  else{ 
    theJSON.nuclide = theJSON.element.concat("", theJSON.A);
    theJSON.A = parseInt(theJSON.A);
  }

  theJSON.state = String(theJSON.state || "").trim();
  if(["m", "n", "p", "q", "r", "x"].includes(theJSON.state)){
    theJSON.nuclide = theJSON.nuclide.concat("", theJSON.state);
  }
  
  //Check for theory mark on mass excess
  for(let i=0; i<theJSON.MassExcess.length; i++){
    var thisChar = theJSON.MassExcess.at(i);
    if(thisChar == '#'){
      theJSON.MassExcess = theJSON.MassExcess.slice(0, i);
      i=theJSON.MassExcess.length;
      theJSON.MassTheory = true;
    }
  }

  //Remove white space from mass excess, convert to float
  theJSON.MassExcess = parseFloat(theJSON.MassExcess);

  //Remove white space from mass excess error, convert to float
  for(let i=0; i<theJSON.dMassExcess.length; i++){
    var thisChar = theJSON.dMassExcess.at(i);
    if(thisChar == '#'){
      theJSON.dMassExcess = theJSON.dMassExcess.slice(0, i);
      i=theJSON.dMassExcess.length;
    }
  }
  theJSON.dMassExcess = parseFloat(theJSON.dMassExcess);

  switch(theJSON.i){
    case '1':
    case '2': 
      theJSON.isIsomer = true;
      theJSON.ExcitationEnergy = parseFloat(theJSON.ExcitationEnergy);
      theJSON.dExcitationEnergy = parseFloat(theJSON.dExcitationEnergy);
      break;
    case '3': 
    case '4': 
      theJSON.isLevel = true;
      theJSON.ExcitationEnergy = parseFloat(theJSON.ExcitationEnergy);
      theJSON.dExcitationEnergy = parseFloat(theJSON.dExcitationEnergy);
      break;
    case '5':
      theJSON.isResonances = true; 
      theJSON.ExcitationEnergy = parseFloat(theJSON.ExcitationEnergy);
      theJSON.dExcitationEnergy = parseFloat(theJSON.dExcitationEnergy);
      break;
    case '8':
    case '9': 
      theJSON.isIAS = true;
      theJSON.ExcitationEnergy = parseFloat(theJSON.ExcitationEnergy);
      theJSON.dExcitationEnergy = parseFloat(theJSON.dExcitationEnergy);
      break;
    default: 
      theJSON.ExcitationEnergy = 0;
      theJSON.dExcitationEnergy = 0;
  }

  //Remove white space from half-life, convert to float
  while(theJSON.Halflife.at(0) == ' '){
    theJSON.Halflife = theJSON.Halflife.slice(1, theJSON.Halflife.length);
  }
  while(theJSON.Halflife.at(theJSON.Halflife.length-1) == ' '){
    theJSON.Halflife = theJSON.Halflife.slice(0, theJSON.Halflife.length-1);
  }
  if(theJSON.Halflife == "stbl"){ 
    theJSON.isStable = true;
    theJSON.halflifeSeconds = 1e14;
    var endVal = 0;
    for(let i=0; i<theJSON.BR.length; i++) if(theJSON.BR.at(i) == ' ') endVal = i;
//    theJSON.abundance = parseFloat(theJSON.BR.slice(3, endVal));
    theJSON.abundance = parseIsotopicAbundance(theJSON.BR);
  }
  else{
//      console.log(theJSON.Halflife);
    theJSON.Halflife = parseFloat(theJSON.Halflife);
    if(isNaN(theJSON.Halflife)) theJSON.Halflife = 0;
    if(theJSON.BR.slice(0,2) == "IS"){ 
      var endVal = 0;
      for(let i=0; i<theJSON.BR.length; i++) if(theJSON.BR.at(i) == ' ') endVal = i;
//      theJSON.abundance = parseFloat(theJSON.BR.slice(3, endVal));
      theJSON.abundance = parseIsotopicAbundance(theJSON.BR);
    }
    else theJSON.abundance = 0;
  }

  //Remove white space from half-life, convert to float
  while(theJSON.dHalflife.at(0) == ' '){
    theJSON.dHalflife = theJSON.dHalflife.slice(1, theJSON.dHalflife.length);
  }
  while(theJSON.dHalflife.at(theJSON.dHalflife.length-1) == ' '){
    theJSON.dHalflife = theJSON.dHalflife.slice(0, theJSON.dHalflife.length-1);
  }
  theJSON.dHalflife = parseFloat(theJSON.dHalflife);
  if(isNaN(theJSON.dHalflife)) theJSON.dHalflife = 0;

  //Remove white space from halflife unit
  while(theJSON.t12unit.at(0) == ' '){
    theJSON.t12unit = theJSON.t12unit.slice(1, theJSON.t12unit.length);
  }
  while(theJSON.t12unit.at(theJSON.t12unit.length) == ' '){
    theJSON.t12unit = theJSON.t12unit.slice(0, theJSON.t12unit.length-1);
  }

  //Set halflife in seconds
  switch(theJSON.t12unit){
    case "Py":
      theJSON.halflifeSeconds = 1e12*365*24*3600*theJSON.Halflife;
      break;
    case "Gy":
      theJSON.halflifeSeconds = 1e9*365*24*3600*theJSON.Halflife;
      break;
    case "My":
      theJSON.halflifeSeconds = 1e6*365*24*3600*theJSON.Halflife;
      break;
    case "ky":
      theJSON.halflifeSeconds = 1e3*365*24*3600*theJSON.Halflife;
      break;
    case "y":
      theJSON.halflifeSeconds = 365*24*3600*theJSON.Halflife;
      break;
    case "d":
      theJSON.halflifeSeconds = 24*3600*theJSON.Halflife;
      break;
    case "h":
     theJSON.halflifeSeconds = 3600*theJSON.Halflife;
      break;
    case "m":
      theJSON.halflifeSeconds = 60*theJSON.Halflife;
      break;
    case "s": 
      theJSON.halflifeSeconds = theJSON.Halflife;
      break;
    case "ms":
      theJSON.halflifeSeconds = 1e-3*theJSON.Halflife;
      break;
    case "us":
      theJSON.halflifeSeconds = 1e-6*theJSON.Halflife;
      break;
    case "ns":
      theJSON.halflifeSeconds = 1e-9*theJSON.Halflife;
      break;
    default: 
      if(theJSON.Halflife !== "stbl") theJSON.halflifeSeconds = 0;
  }

  return theJSON;
}

//----------------------------------------------------  
function loadNUBASE(){
  var theNUBASE = new Array();
  fetch("nubase_4.mas20.txt")
    .then((res) => res.text())
    .then((text) => {
      var theWholeTable = new Array();
      theWholeTable = text.split(/\r\n|\n/);       
//      console.log("theWholeTable has %i entries", theWholeTable.length);
//        console.log(theWholeTable.at(0));
      for(let i=0; i<theWholeTable.length; i++){
//          if(theWholeTable.at(i).at(0) == '#') console.log(theWholeTable.at(i));
//          else{
        if(!(theWholeTable.at(i).at(0) == '#')){
          var thisLineAsJSON={
            A: "",
            Z: "",
            i: "",
            nuclide: "",
            element: "",
            state: "",
            MassExcess: "",
            dMassExcess: "",
            MassTheory: false,
            isIsomer: false,
            isLevel: false,
            isResonances: false,
            isIAS: false,
            isStable: false,
            stateOrigin: "",
            isomericOrder: "",
            ExcitationEnergy: "",
            dExcitationEnergy: "",
            Halflife: "",
            t12unit: "",
            dHalflife: "",
            halflifeSeconds: 0,
            spin: "",
            spinHow: "",
            ensdfYear: "",
            discoYear: "",
            abundance: "",
            BR: ""
          };
          thisLineAsJSON.A = theWholeTable.at(i).slice(0,3);
          thisLineAsJSON.Z = theWholeTable.at(i).slice(4,7);
          thisLineAsJSON.i = theWholeTable.at(i).at(7);
          thisLineAsJSON.nuclide = theWholeTable.at(i).slice(11,16);
          thisLineAsJSON.state = theWholeTable.at(i).at(16);
          thisLineAsJSON.MassExcess = theWholeTable.at(i).slice(18,31);
          thisLineAsJSON.dMassExcess = theWholeTable.at(i).slice(31,42);
          thisLineAsJSON.ExcitationEnergy = theWholeTable.at(i).slice(42,54);
          thisLineAsJSON.dExcitationEnergy = theWholeTable.at(i).slice(54,65);
          thisLineAsJSON.stateOrigin = theWholeTable.at(i).slice(65,67);
          thisLineAsJSON.isomericOrder = theWholeTable.at(i).slice(67,69);
          thisLineAsJSON.Halflife = theWholeTable.at(i).slice(69,78);
          thisLineAsJSON.t12unit = theWholeTable.at(i).slice(78,80);
          thisLineAsJSON.dHalflife = theWholeTable.at(i).slice(81,88);
          thisLineAsJSON.spin = theWholeTable.at(i).slice(88,102);
          thisLineAsJSON.ensdfYear = theWholeTable.at(i).slice(102,104);
          thisLineAsJSON.discoYear = theWholeTable.at(i).slice(114,118);
          thisLineAsJSON.BR = theWholeTable.at(i).slice(119, 209);

          thisLineAsJSON = finalParse(thisLineAsJSON);

//          if(thisLineAsJSON.element[0] == "V") console.log(thisLineAsJSON);
          theNUBASE.push(thisLineAsJSON);
          if (!nubaseByNuclide.has(thisLineAsJSON.nuclide)) {
            nubaseByNuclide.set(thisLineAsJSON.nuclide, thisLineAsJSON);
          }
        }         
      }
    })
    .catch((e) => console.error(e));
//    getChart();
  return theNUBASE;
}

//----------------------------------------------------  

function getChart(mydiv){
  var symbols = new Array();

  async function getSymbols(){
    return fetch("periodic.data")
        .then((res) => res.text())
        .then((text) => {
          var theWholeTable = new Array();
          theWholeTable = text.split(/\r\n|\n/);       
//          console.log("The periodic table has %i entries", theWholeTable.length);
          for(let i=0; i<theWholeTable.length; i++){
              var thisData = new Array();
              thisData = theWholeTable.at(i).split(' ');
              var thisJSON = {Symbol: "", row: "", column: "", selected: "N"};
              if(thisData.length == 3){
                thisJSON.Symbol = thisData.at(0);
                thisJSON.row = parseFloat(thisData.at(1));
                thisJSON.column = parseFloat(thisData.at(2));
                  symbols.push(thisJSON);
//                  console.log(symbols.at(i));
              }
              else console.log(thisData.length);
          }
        })
        .catch((e) => console.error(e));
  }

  async function doIt(){
    await getSymbols();
//    console.log(symbols);
//    console.log(symbols.length);
    for(let i=0; i<symbols.length;i++){
      var btnThisElement = document.createElement("button");
      btnThisElement.index = i;
      btnThisElement.id = "btnElement"+i;
      btnThisElement.type = "text";
      btnThisElement.style.position = 'absolute';
      btnThisElement.style.backgroundColor = "yellow";
      btnThisElement.style.left = 1.5+27*symbols.at(i).column + "px";
      btnThisElement.style.top = 1.5+15*symbols.at(i).row + "px";
      btnThisElement.style.width = '27px';
      btnThisElement.style.font = "10px Arial";
      btnThisElement.title = "Click: natural isotopes; Shift-click: natural plus radioactive isotopes";
      btnThisElement.addEventListener("click",
        function(event){
          const idx = parseInt(this.index);
          const current = symbols.at(idx).selected;

          if(event.shiftKey){
            // Shift-click cycles R <-> N
            if(current === "R"){
              this.style.backgroundColor = "yellow";
              symbols.at(idx).selected = "N";
            }
            else{
              this.style.backgroundColor = "pink";
              symbols.at(idx).selected = "R";
            }
          }
          else{
            // Normal click cycles Y <-> N
            if(current === "Y"){
              this.style.backgroundColor = "yellow";
              symbols.at(idx).selected = "N";
            }
            else{
              this.style.backgroundColor = "green";
              symbols.at(idx).selected = "Y";
            }
          }
        }, false);
/*
      btnThisElement.addEventListener("click", 
        function(){
          if(this.style.backgroundColor === "green"){ 
            this.style.backgroundColor = "yellow";
            symbols.at(parseInt(this.index)).selected = "N";
          }
          else{
             this.style.backgroundColor = "green";
             symbols.at(parseInt(this.index)).selected = "Y";
          }
        }, false);
*/
        btnThisElement.innerHTML = symbols.at(i).Symbol;
      mydiv.appendChild(btnThisElement);
    }
  }

  doIt().then(() => document.dispatchEvent(new Event("ufo-elements-ready")));

  return symbols;
}
//----------------------------------------------------  

function getElementIndex(theElement){
  for(let i=0; i<periodicData.length;i++){
    if(periodicData.at(i).Symbol == theElement) return i;
  }
  return -1;
}
//----------------------------------------------------  

function fnSelectNone(){
  for(let i=0; i<periodicData.length;i++){
    var thisButton = document.getElementById("btnElement"+i);
    thisButton.style.backgroundColor = "yellow";
    thisButton.selected = "N";
    periodicData.at(i).selected = "N";
  }
  console.log("Nothing?");
}
//----------------------------------------------------  

function fnStandardSelection(){
  var standardArray = ["H", "C", "N", "O", "F", "S", "Ar"];
  fnSelectNone();
  for(let i=0; i<standardArray.length; i++){
    var thisIndex = getElementIndex(standardArray.at(i));
    var thisButton = document.getElementById("btnElement"+thisIndex);
    thisButton.style.backgroundColor = "green";
    thisButton.selected = "Y";
    periodicData.at(thisIndex).selected = "Y";
  }

  getListOfSelectedIsotopes();
}
//----------------------------------------------------  

function getListOfSelectedElements(){
  var selectedElements = new Array();
  for(let i=0; i<periodicData.length;i++){
    if(periodicData.at(i).selected === "Y" || periodicData.at(i).selected === "R"){ 
//      console.log(periodicData.at(i).Symbol);
//      selectedElements.push(periodicData.at(i).Symbol);
        selectedElements.push({
          Symbol: periodicData.at(i).Symbol,
          selected: periodicData.at(i).selected
        });
    }
  }

  return selectedElements;
}
//----------------------------------------------------  

function getListOfSelectedIsotopes(){
  var theSelectedIsotopes = new Array();
  var theSelectedElements = getListOfSelectedElements();
  var minAbundance = parseFloat(document.getElementById("minAbundance").value);
  var maxRIs = parseFloat(document.getElementById("selMaxRI").value);
  var minHalflife = parseFloat(document.getElementById("minHalflife").value);
/*
  console.log(minAbundance);
  console.log(maxRIs);
  console.log(minHalflife);
*/
  for(let i=0; i<theSelectedElements.length; i++){
//    var thisElement = theSelectedElements.at(i);
    var thisElement = theSelectedElements.at(i).Symbol;
    var thisSelectionMode = theSelectedElements.at(i).selected; // "Y" or "R"
//    console.log(thisElement);
    for(let j=0; j<NUBASE.length; j++){
      if(thisElement == NUBASE.at(j).element){ 
        if(parseFloat(NUBASE.at(j).abundance) > minAbundance){
//          console.log(NUBASE.at(j).nuclide);
          theSelectedIsotopes.push(NUBASE.at(j).nuclide);
        }
        if(maxRIs > 0) if(parseFloat(NUBASE.at(j).abundance) == 0 && thisSelectionMode === "R"){
          if(NUBASE.at(j).halflifeSeconds > minHalflife){
//            console.log("%s, %d s", NUBASE.at(j).nuclide, NUBASE.at(j).halflifeSeconds);
            theSelectedIsotopes.push(NUBASE.at(j).nuclide);
          } 
        }
      }
    }
  }
  return theSelectedIsotopes;
}
//----------------------------------------------------  

function updateElementButton(element, button){
  button.style.backgroundColor = element.selected === "R" ? "pink" : element.selected === "Y" ? "green" : "yellow";
  button.setAttribute("aria-label", element.Symbol + ": " +
    (element.selected === "R" ? "natural plus radioactive isotopes" : element.selected === "Y" ? "natural isotopes" : "excluded"));
}

var activeSCMSearch = null;

function ensureSCMProgressUI(){
  const btn = document.getElementById("btnFindSCM");
  if(!btn) return;

  if(!document.getElementById("SCMProgressContainer")){
    const container = document.createElement("div");
    container.id = "SCMProgressContainer";
    container.style.position = "absolute";
    container.style.left = "5px";
    container.style.top = "82px";
    container.style.width = "215px";
    container.style.height = "22px";
    container.style.fontFamily = "Arial, Helvetica, sans-serif";
    container.style.fontSize = "11px";

    const label = document.createElement("div");
    label.id = "SCMProgressText";
    label.textContent = "Ready";
    label.style.height = "12px";
    label.style.overflow = "hidden";

    const outer = document.createElement("div");
    outer.id = "SCMProgressOuter";
    outer.style.width = "100%";
    outer.style.height = "8px";
    outer.style.border = "1px solid #555";
    outer.style.background = "#eee";

    const inner = document.createElement("div");
    inner.id = "SCMProgressInner";
    inner.style.width = "0%";
    inner.style.height = "100%";
    inner.style.background = "#77aa77";

    outer.appendChild(inner);
    container.appendChild(label);
    container.appendChild(outer);
    btn.parentNode.insertBefore(container, btn);
  }
}

function updateSCMProgress(done, total, message){
  ensureSCMProgressUI();
  const text = document.getElementById("SCMProgressText");
  const bar = document.getElementById("SCMProgressInner");
  const pct = total > 0 ? Math.max(0, Math.min(100, 100 * done / total)) : 0;
  if(text) text.textContent = message || (pct.toFixed(0) + "%");
  if(bar) bar.style.width = pct.toFixed(1) + "%";
}

function clearSCMTable(){
  var tbl = document.getElementById("SCMTable");
  const oldTbody = tbl.querySelector("tbody");
  if(oldTbody) oldTbody.remove();
  const tblBody = document.createElement("tbody");
  tbl.setAttribute("border", "1");
  tbl.appendChild(tblBody);
  return tblBody;
}

function sortSCMTableBySigma(){
  const tbl = document.getElementById("SCMTable");
  const tbody = tbl.querySelector("tbody");
  if(!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));

  rows.sort((a, b) => {
    const sigmaA = parseFloat(a.children[3].textContent);
    const sigmaB = parseFloat(b.children[3].textContent);
    return sigmaA - sigmaB;
  });

  for(const row of rows){
    tbody.appendChild(row);
  }
}

function addSCMResultRow(tblBody, result, charge){
  const row = document.createElement("tr");

  const cellMoleculeName = document.createElement("td");
  cellMoleculeName.dataset.copyText = result.name;
  cellMoleculeName.innerHTML = getMarkup(result.name, charge);
  row.appendChild(cellMoleculeName);

  const cellMoleculeMass = document.createElement("td");
  cellMoleculeMass.appendChild(document.createTextNode(parseFloat(result.mass).toFixed(9)));
  row.appendChild(cellMoleculeMass);

  const cellMoleculeLaps = document.createElement("td");
  cellMoleculeLaps.appendChild(document.createTextNode(result.laps));
  row.appendChild(cellMoleculeLaps);

  const cellMoleculeDevSigma = document.createElement("td");
  cellMoleculeDevSigma.appendChild(document.createTextNode(parseFloat(result.sigma).toFixed(2)));
  row.appendChild(cellMoleculeDevSigma);

  const cellMoleculeDevKeV = document.createElement("td");
  cellMoleculeDevKeV.appendChild(document.createTextNode(parseFloat(result.mdevKeV).toFixed(1)));
  row.appendChild(cellMoleculeDevKeV);

  if(result.numRI > 0) row.style.backgroundColor = "pink";
  tblBody.appendChild(row);
}

//----------------------------------------------------
function makeSCMTableCSV() {
  const tbl = document.getElementById("SCMTable");
  if(!tbl) return "";

  const lines = [];
  const crlf = "\r\n";

  const headerCells = Array.from(tbl.querySelectorAll("thead th"));
  const headers = headerCells.map(th => csvEscape(th.textContent.trim()));
  lines.push(headers.join(","));

  const rows = Array.from(tbl.querySelectorAll("tbody tr"));

  for(const row of rows){
    const cells = Array.from(row.querySelectorAll("td"));

    const values = cells.map((cell, index) => {
      if(index === 0 && cell.dataset.copyText){
        return csvEscape(cell.dataset.copyText);
      }
      return csvEscape(cell.textContent.trim());
    });

    lines.push(values.join(","));
  }

  return lines.join(crlf) + crlf;
}

function csvEscape(value) {
  value = String(value ?? "");

  if(value.includes('"') || value.includes(",") || value.includes("\r") || value.includes("\n")){
    value = '"' + value.replace(/"/g, '""') + '"';
  }

  return value;
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

//----------------------------------------------------

function stopActiveSCMSearch(){
  if(activeSCMSearch && activeSCMSearch.workers){
    for(const worker of activeSCMSearch.workers){
      try { worker.terminate(); } catch(e) { console.warn(e); }
    }
  }
  activeSCMSearch = null;
}

function fnFindSCM() {
  if(activeSCMSearch){
    if(activeSCMSearch) activeSCMSearch.cancelled = true;
    stopActiveSCMSearch();
    document.getElementById("btnFindSCM").innerHTML = "Find Them!";
    document.getElementById("lblSearching").innerHTML = "Search cancelled";
    updateSCMProgress(0, 1, "Cancelled");
    return;
  }

  document.getElementById("btnFindSCM").innerHTML = "Stop";
  updateSCMProgress(0, 1, "Starting...");

  setTimeout(() => reallyFindSCM().catch(error => {
    console.error(error);
    alert(error.message || error);
    stopActiveSCMSearch();
    document.getElementById("btnFindSCM").innerHTML = "Find Them!";
    updateSCMProgress(0, 1, "Error");
  }), 0);
}
//----------------------------------------------------  

function howRadioactive(name){
  var numRI = 0;
  var theNuclides = name.split(/;|:/);
  var theAtoms = new Array();
  for(let i=0; i<theNuclides.length; i++){
    const thisPart = theNuclides.at(i);
    for(let j=0; j<thisPart.length; j++){
      var thisChar = thisPart.at(j);
      if(!(thisChar >= '0' && thisChar <= '9')){ 
        var theNuclide = thisPart.slice(j, thisPart.length);
        var theNumber = thisPart.slice(0, j);
        if(j == 0) theNumber = 1;
        theAtoms.push({nuclide: theNuclide, theNumber: theNumber});
        j=thisPart.length;
      }
    }
  }

  var theMass = 0;
  for(let i=0; i<theAtoms.length; i++){
//    var theJSON = NUBASE.find(({nuclide}) => nuclide === theAtoms.at(i).nuclide);
    var theJSON = nubaseByNuclide.get(theAtoms.at(i).nuclide);
//    if (typeof myVar !== 'undefined') console.log(theJSON);
    var n= parseFloat(theAtoms.at(i).theNumber);
    if(theJSON.abundance == 0) numRI += n;    
  }
  return numRI;
}
//----------------------------------------------------  

function evaluateCandidate(theCandidate, charge){
  var theNuclides = theCandidate.split(/;|:/);
  var totalMassKeV = 0;
  var numRI = 0;

  for(let i = 0; i < theNuclides.length; i++){
    const thisPart = theNuclides.at(i);

    for(let j = 0; j < thisPart.length; j++){
      var thisChar = thisPart.at(j);

      if(!(thisChar >= '0' && thisChar <= '9')){
        var theNuclide = thisPart.slice(j, thisPart.length);
        var theNumber = thisPart.slice(0, j);
        if(j == 0) theNumber = 1;

        var theJSON = nubaseByNuclide.get(theNuclide);
        var n = parseFloat(theNumber);

        totalMassKeV += n * (theJSON.A * ukeV + theJSON.MassExcess);

        if(theJSON.abundance == 0) {
          numRI += n;
        }

        j = thisPart.length;
      }
    }
  }

  totalMassKeV -= parseFloat(charge) * eMasskeV;

  return {
    mass: parseFloat(String(totalMassKeV / ukeV)).toFixed(9),
    numRI: numRI
  };
}
//----------------------------------------------------  
async function reallyFindSCM(){
  const startTime = performance.now();
  const tblBody = clearSCMTable();

  var theNuclide1 = document.getElementById("NameRef1");
  var theCharge1 = parseFloat(document.getElementById("selCharge1").value);
  var theMass1 = getMass(theNuclide1.value, theCharge1);
  document.getElementById("Mass1").innerHTML = String(theMass1).concat("", " u");

  var t_ref = parseFloat(document.getElementById("ToF_Ref1").value);
  var dt_ref = parseFloat(document.getElementById("ToF_Ref1err").value);
  if(document.getElementById("ToF_Ref1err").value == "") dt_ref = 0;

  var m_ref = parseFloat(document.getElementById("Mass1").innerHTML);
  var q_ref = parseFloat(document.getElementById("selCharge1").value);
  var m_lap = parseFloat(document.getElementById("ref1Laps").value);

  var t_SCM = parseFloat(document.getElementById("ToF_SCM").value);
  var dt_SCM = parseFloat(document.getElementById("ToF_SCMErr").value);
  if(document.getElementById("ToF_SCMErr").value == "") dt_SCM = 0;

  var q_SCM = parseFloat(document.getElementById("selChargeSCM").value);
  var laps_SCM = parseFloat(document.getElementById("SCMLaps").value);

  if(document.getElementById("SCMLaps").value == ""){
    laps_SCM = m_lap;
    document.getElementById("SCMLaps").value = laps_SCM;
  }

  var SCMLapsRange = parseFloat(document.getElementById("SCMLapsRange").value);
  if(document.getElementById("SCMLapsRange").value == ""){
    SCMLapsRange = 0;
    document.getElementById("SCMLapsRange").value = SCMLapsRange;
  }

  var theSelectedIsotopes = getListOfSelectedIsotopes();
  if(theSelectedIsotopes.length == 0){
    alert("No isotopes to choose from!");
    document.getElementById("btnFindSCM").innerHTML = "Find Them!";
    updateSCMProgress(0, 1, "No isotopes selected");
    activeSCMSearch = null;
    return;
  }

  var maxElements = parseInt(document.getElementById("selMaxElements").value);
  var maxAtoms = parseInt(document.getElementById("selMaxAtoms").value);
  var maxNumRI = parseInt(document.getElementById("selMaxRI").value);
  var maxSigma = parseFloat(document.getElementById("maxSigma").value);

  var isotopeInfo = [];
  for(let i = 0; i < theSelectedIsotopes.length; i++){
    var nuclideName = theSelectedIsotopes.at(i);
    var entry = nubaseByNuclide.get(nuclideName);
    if(typeof entry !== "undefined"){
      isotopeInfo.push({
        nuclide: nuclideName,
        neutralMassKeV: entry.A * ukeV + entry.MassExcess,
        isRadioactive: parseFloat(entry.abundance) == 0
      });
    }
  }
  isotopeInfo.sort((a, b) => a.neutralMassKeV - b.neutralMassKeV);

  const firstLap = Math.round(laps_SCM - SCMLapsRange);
  const lastLap = Math.round(laps_SCM + SCMLapsRange);
  const lapJobs = [];

  var t0Calc = getT0ForCalculation();
  if(t0Calc == null){
    document.getElementById("btnFindSCM").innerHTML = "Find Them!";
    updateSCMProgress(0, 1, "Need t_0");
    activeSCMSearch = null;
    return;
  }

  const needsB = (firstLap != m_lap) || (lastLap != m_lap);
  let bCalc = null;
  if(needsB){
    bCalc = getBForCalculation();

    if(bCalc == null){
      document.getElementById("btnFindSCM").innerHTML = "Find Them!";
      updateSCMProgress(0, 1, "Need b-value");
      activeSCMSearch = null;
      return;
    }
  }

  for(let lapsThis = firstLap; lapsThis <= lastLap; lapsThis++){
    const lapDiff = lapsThis - m_lap;
    let t_ref_this = t_ref;
    let dt_ref_this = dt_ref;

    if(lapDiff != 0){
      if(bCalc.val == 0 || isNaN(bCalc.val)){
        alert("Need to evaluate b-value to do this!");
        document.getElementById("btnFindSCM").innerHTML = "Find Them!";
        updateSCMProgress(0, 1, "Need b-value");
        activeSCMSearch = null;
        return;
      }

      t_ref_this = t_ref + lapDiff * bCalc.val;
      dt_ref_this = Math.sqrt(
        dt_ref * dt_ref +
        Math.pow(Math.abs(lapDiff) * bCalc.err, 2)
      );

      if(isNaN(dt_ref_this)){
        dt_ref_this = 1;
        alert("Assuming default ToF uncertainty dt=1ns");
      }
    }

    var m_SCM =
      (q_SCM / q_ref) *
      m_ref *
      Math.pow(t_SCM - t0Calc.val, 2) /
      Math.pow(t_ref_this - t0Calc.val, 2);

    var dm_SCM =
      Math.sqrt(
/*
        (dt_ref_this * dt_ref_this) / (t_ref_this * t_ref_this) +
        (dt_SCM * dt_SCM) / (t_SCM * t_SCM)
*/
        (dt_ref_this * dt_ref_this) / Math.pow(t_ref_this - t0Calc.val, 2) +
        (dt_SCM * dt_SCM) / Math.pow(t_SCM - t0Calc.val, 2)
      ) * m_SCM;

    var massToleranceU = maxSigma * dm_SCM;
    var lowerMassU = m_SCM - massToleranceU;
    var upperMassU = m_SCM + massToleranceU;

    lapJobs.push({
      lapsThis,
      m_SCM,
      dm_SCM,
      massToleranceU,
      lowerNeutralMassKeV: lowerMassU * ukeV + q_SCM * eMasskeV,
      upperNeutralMassKeV: upperMassU * ukeV + q_SCM * eMasskeV
    });
  }

  const totalJobs = lapJobs.length;
  let finishedJobs = 0;
  let totalResults = 0;
  let totalVisited = 0;
  const allWinners = new Set();
  const workers = new Set();
  const maxWorkers = Math.max(1, Math.min(totalJobs, (navigator.hardwareConcurrency || 4) - 1, 4));

  activeSCMSearch = { workers, cancelled: false };
  updateSCMProgress(0, totalJobs, "Starting " + totalJobs + " lap search(es)...");
  document.getElementById("lblSearching").innerHTML = "Starting worker search...";

  await new Promise((resolve, reject) => {
    let nextJobIndex = 0;

    function launchNext(){
      if(!activeSCMSearch || activeSCMSearch.cancelled) return resolve();

      while(workers.size < maxWorkers && nextJobIndex < lapJobs.length){
        const job = lapJobs[nextJobIndex++];
        const worker = new Worker("searchWorker.js");
        workers.add(worker);

        worker.onmessage = (event) => {
          const msg = event.data;

          if(msg.type === "batch"){
            for(const result of msg.results){
              const winnerKey = result.name + "_laps_" + result.laps;
              if(allWinners.has(winnerKey)) continue;
              allWinners.add(winnerKey);
              addSCMResultRow(tblBody, result, q_SCM);
              totalResults++;
            }
            document.getElementById("lblSearching").innerHTML =
              totalResults + " winners found so far";
          }
          else if(msg.type === "progress"){
            totalVisited += msg.visitedSinceLast || 0;
            updateSCMProgress(
              finishedJobs,
              totalJobs,
              "Lap " + msg.lapsThis + ": searching... (" + totalResults + " winners)"
            );
          }
          else if(msg.type === "done"){
            workers.delete(worker);
            worker.terminate();
            finishedJobs++;
            updateSCMProgress(
              finishedJobs,
              totalJobs,
              "Finished " + finishedJobs + "/" + totalJobs + " lap searches"
            );
            launchNext();
            if(finishedJobs >= totalJobs) resolve();
          }
          else if(msg.type === "error"){
            workers.delete(worker);
            worker.terminate();
            reject(new Error(msg.message));
          }
        };

        worker.onerror = (error) => {
          workers.delete(worker);
          try { worker.terminate(); } catch(e) {}
          reject(error);
        };

        worker.postMessage({
          type: "start",
          isotopeInfo,
          maxElements,
          maxAtoms,
          maxNumRI,
          q_SCM,
          ukeV,
          eMasskeV,
          job
        });
      }
    }

    launchNext();
  });

  sortSCMTableBySigma();

  const endTime = performance.now();
  const elapsedMs = endTime - startTime;
  document.getElementById("lblSearching").innerHTML =
    totalResults + " winners found in " + elapsedMs.toFixed(1) + " ms";
  updateSCMProgress(totalJobs, totalJobs, "Done: " + totalResults + " winner(s)");
  document.getElementById("btnFindSCM").innerHTML = "Find Them!";
  activeSCMSearch = null;
}

//----------------------------------------------------  

function getT0ForCalculation() {
  const t0Input = document.getElementById("t0");
  const t0 = parseFloat(t0Input.value);

  if (!Number.isFinite(t0)) {
    alert("We will need a t_0 value to calculate things...");
    return null;
  }

  let dt0 = DEFAULT_T0_ERR_NS;

  const calcT0 = parseFloat(t0withErr.val);
  const calcDt0 = parseFloat(t0withErr.err);

  const hasCalculatedT0 =
    Number.isFinite(calcT0) &&
    Number.isFinite(calcDt0) &&
    calcDt0 > 0;

  if (hasCalculatedT0) {
    const matchesCalculatedT0 = Math.abs(t0 - calcT0) < 0.005; // ns tolerance

    if (matchesCalculatedT0) {
      dt0 = calcDt0;
      warnedAboutT0Mismatch = false;
    } else if (!warnedAboutT0Mismatch) {
      alert(
        "The Estimated t_0 value has been edited after calculating t_0. " +
        "Using the entered t_0 value, but assuming dt_0 = 10 ns."
      );
      warnedAboutT0Mismatch = true;
    }
  }

return { val: t0, err: dt0 };
}

//----------------------------------------------------  

function getBForCalculation() {
  const bInput = document.getElementById("bEstimate");
  const b = parseFloat(bInput.value);

  if (!Number.isFinite(b)) {
    alert("We need a b-value for reference 1!");
    return null;
  }

  let db = DEFAULT_B_ERR_NS;

  const calcB = parseFloat(bwithErr.val);
  const calcDb = parseFloat(bwithErr.err);

  const hasCalculatedB =
    Number.isFinite(calcB) &&
    Number.isFinite(calcDb) &&
    calcDb > 0;

  if (hasCalculatedB) {
    const matchesCalculatedB = Math.abs(b - calcB) < 0.005; // ns tolerance

    if (matchesCalculatedB) {
      db = calcDb;
      warnedAboutBMismatch = false;
    } else if (!warnedAboutBMismatch) {
      alert(
        "The estimated b-value has been edited after calculating b. " +
        "Using the entered b-value, but assuming db = 1 ns."
      );
      warnedAboutBMismatch = true;
    }
  }

  return { val: b, err: db };
}

//----------------------------------------------------

function runningInElectron() {
  return !!window.electronAPI || navigator.userAgent.includes("Electron");
}