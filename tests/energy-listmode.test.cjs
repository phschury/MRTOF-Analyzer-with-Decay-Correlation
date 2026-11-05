const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseEnergyListmode,energyHistogram,detectorName,COUNTER_MODULUS}=require('../energy-listmode');

test('Box detector sum includes channels 11–15 and respects module and elapsed-time filters',()=>{
 const data=parseEnergyListmode('1,10,10,0\n1,11,11,100\n1,12,12,200\n1,13,13,300\n1,14,14,400\n1,15,15,500\n1,16,16,600\n0,11,17,700');
 const calibrations=Object.fromEntries(data.channels.map(row=>[row.module+':'+row.channel,{gain:1,offset:0}]));
 const sum=options=>energyHistogram(data,{channel:'box-sum',...options},calibrations);
 const summed=sum({module:1});assert.equal(summed.unit,'keV');
 assert.equal(summed.selectedEvents,5);assert.equal(summed.plottedEvents,5);
 assert.deepEqual(summed.counts.slice(10),[0,1,1,1,1,1]);
 assert.equal(sum({}).plottedEvents,6);
 assert.equal(sum({module:0}).plottedEvents,1);
 assert.equal(sum({module:1,timeLow:0.000002,timeHigh:0.000005}).plottedEvents,3);
 assert.equal(energyHistogram(data,{module:1,channel:11}).plottedEvents,1);
 const usb=parseEnergyListmode('0,10,10\n100,11,11\n200,15,15\n300,16,16');
 assert.throws(()=>energyHistogram(usb,{channel:'box-sum'}),/requires an energy calibration/);
});
test('Box detector sum bins each channel in calibrated keV with an automatic range',()=>{
 const data=parseEnergyListmode('1,11,100,0\n1,12,50,100\n1,15,20,200');
 const calibrations={'1:11':{gain:2,offset:10},'1:12':{gain:4,offset:10},'1:15':{gain:3,offset:-100}};
 const result=energyHistogram(data,{channel:'box-sum',unit:'ch',gain:999,offset:999,low:999,high:1000,binWidth:10},calibrations);
 assert.equal(result.unit,'keV');assert.deepEqual(result.range,[-40,220]);assert.equal(result.plottedEvents,3);
 assert.equal(result.counts[0],1);assert.equal(result.counts[25],2);
 assert.throws(()=>energyHistogram(data,{channel:'box-sum'},{'1:11':calibrations['1:11']}),/module 1, channel 12/);
});

test('Niki records follow the PDF column order, detector assignments and 10 ns timebase',()=>{
 const data=parseEnergyListmode('1,3,6363,577119023936,4\n1,14,1934,577119862975,4\n1,12,2052,577119862987,4\n0,7,1000,577119862990');
 assert.equal(data.format,'niki');assert.equal(data.events.length,4);assert.deepEqual([...data.events.pulse],[6363,1934,2052,1000]);
 assert.equal(data.timebaseNs,10);assert.equal(data.events.additional[0],4);assert.ok(Number.isNaN(data.events.additional[3]));
 assert.equal(detectorName(1,12,'niki'),'Box Right-Si');assert.equal(detectorName(1,13,'niki'),'Box Left-Si');
 assert.equal(detectorName(1,14,'niki'),'Box Top-Si');assert.equal(detectorName(1,15,'niki'),'Box Center-Si');
 assert.equal(detectorName(0,7,'niki'),'Si array 7');
 assert.equal(energyHistogram(data).recordedSpanSec,(577119862990-577119023936)*10/1e9);
});
test('USB-MCA three-column data use timestamp, channel, pulse height without assuming time units',()=>{
 const data=parseEnergyListmode('\uFEFF2280,1,148\r\n8480,1,266\r\n9000,4,500\r\n');
 assert.equal(data.format,'usb-mca');assert.equal(data.timebaseNs,null);assert.deepEqual([...data.events.ticks],[2280,8480,9000]);
 assert.deepEqual([...data.events.pulse],[148,266,500]);assert.equal(energyHistogram(data).recordedSpanSec,null);
 assert.throws(()=>energyHistogram(data,{timeLow:0}),/timebase/);
 assert.equal(energyHistogram(data,{timebaseNs:1000}).recordedSpanSec,0.00672);
});
test('40-bit timestamp wrap and delayed records retain their correct time order',()=>{
 const data=parseEnergyListmode(`1,11,100,${COUNTER_MODULUS-10}\n1,11,200,5\n1,11,300,${COUNTER_MODULUS-5}\n1,11,400,15`);
 assert.equal(data.rollovers,1);assert.deepEqual([...data.events.ticks],[COUNTER_MODULUS-10,COUNTER_MODULUS+5,COUNTER_MODULUS-5,COUNTER_MODULUS+15]);
 const h=energyHistogram(data,{timeLow:100/1e9,timeHigh:200/1e9});assert.equal(h.selectedEvents,1);assert.equal(h.counts[200],1);
});
test('histograms filter modules, channels, elapsed time and half-open pulse-height ranges',()=>{
 const data=parseEnergyListmode('0,11,10,100\n0,12,20,200\n1,11,30,300\n1,11,40,400');
 const h=energyHistogram(data,{module:1,channel:11,binWidth:10,low:0,high:40,timeLow:0,timeHigh:0.000003});
 assert.equal(h.selectedEvents,1);assert.equal(h.plottedEvents,1);assert.deepEqual(h.counts,[0,0,0,1]);
 const all=energyHistogram(data,{binWidth:10,low:0,high:40});assert.equal(all.plottedEvents,3);assert.equal(all.selectedEvents,4);
});
test('linear energy calibration and partial last-bin centers match the displayed energy range',()=>{
 const data=parseEnergyListmode('0,11,1,100\n0,11,2,200\n0,11,3,300');
 const h=energyHistogram(data,{unit:'keV',gain:2,offset:1,binWidth:2,low:1,high:7});
 assert.deepEqual(h.counts,[0,1,1]);assert.deepEqual(h.x,[2,4,6]);assert.equal(h.unit,'keV');
 const partial=energyHistogram(data,{low:0,high:2.5,binWidth:2});assert.deepEqual(partial.x,[1,2.25]);assert.deepEqual(partial.counts,[1,1]);
});
test('malformed or mixed records and invalid histogram controls fail clearly',()=>{
 for(const text of ['', '1,2','1,,100,200','1,2,3,no','100,1,20\n1,2,3,4','1,2,3,'+COUNTER_MODULUS,'1,2,-3,4'])assert.throws(()=>parseEnergyListmode(text));
 const data=parseEnergyListmode('100,1,200');
 for(const options of [{binWidth:0},{gain:0,unit:'keV'},{high:0},{timebaseNs:0},{timebaseNs:10,timeLow:2,timeHigh:1},{module:1.5},{binWidth:0.0001,high:100}])assert.throws(()=>energyHistogram(data,options));
});

test('Niki channels 0 and 1 are not stored, while full timestamp coverage and input counts are retained',()=>{
 const data=parseEnergyListmode('0,0,100,10\n1,1,200,20\n1,11,300,30\n1,14,400,40\n1,0,500,50');
 assert.equal(data.inputEvents,5);assert.equal(data.skippedEvents,3);assert.equal(data.events.length,2);
 assert.deepEqual([...data.events.channel],[11,14]);assert.equal(data.minTick,10);assert.equal(data.maxTick,50);
 assert.equal(energyHistogram(data).plottedEvents,2);
 const empty=parseEnergyListmode('1,0,500,100\n1,1,500,200');assert.equal(empty.events.length,0);assert.equal(energyHistogram(empty).plottedEvents,0);
});
test('incomplete Niki records at the beginning, middle or end are skipped and counted',()=>{
 const data=parseEnergyListmode('1,11\n1,11,100,100,6\n1,,200,200,6\n1,11,200\n1,11,300,300,\n1,11,400,',{filename:'file_001.dat'});
 assert.equal(data.format,'niki');assert.equal(data.events.length,2);assert.equal(data.inputEvents,2);assert.equal(data.incompleteLines,4);
 assert.deepEqual([...data.events.pulse],[100,300]);assert.equal(data.minTick,100);assert.equal(data.maxTick,300);
 assert.deepEqual(data.incompleteExamples.map(row=>row.line),[1,3,4,6]);assert.equal(data.incompleteExamples[0].filename,'file_001.dat');
 assert.ok(Number.isNaN(data.events.additional[1]));
 assert.equal(energyHistogram(data).plottedEvents,2);
});
test('Niki detection from contents skips subsequent short records, and diagnostic examples stay bounded',()=>{
 const data=parseEnergyListmode('1,11,100,100\n'+'1,11\n'.repeat(20));
 assert.equal(data.incompleteLines,20);assert.equal(data.incompleteExamples.length,5);assert.equal(data.events.length,1);
 assert.throws(()=>parseEnergyListmode('1,11,100,100\n1,11,no,200',{filename:'file.dat'}),/file.dat.*line 2/);
 assert.throws(()=>parseEnergyListmode('1,11\n1,,100,200',{filename:'empty.dat'}),/no complete energy events.*2 incomplete/);
});
