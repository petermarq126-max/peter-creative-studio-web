import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('owner M2 preflight preserves prompt binding, QA costs and approval gate',async()=>{
 const nodes=new Map();
 function node(id){if(!nodes.has(id))nodes.set(id,{id,value:'',checked:true,innerHTML:'',textContent:'',classList:{add(){},remove(){}},addEventListener(){}});return nodes.get(id);}
 const calls=[],ctx={document:{getElementById:node,querySelectorAll:()=>[]},location:{hash:'#token=mock-owner'},URL,URLSearchParams,sessionStorage:{getItem:()=>null},
  fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({estimate:{provider:'openai',model:'gpt-image-2',estimatedUsd:0.007},qaEstimate:{model:'gpt-4.1-mini',estimatedUsd:0.002,approvalCapUsd:0.005},combinedApprovalCapUsd:0.012})};}};
 for(const id of ['prompt','ratio','quality','includeQa','estimateBtn','approval','router','go','canvas','studioTab','libraryTab','libraryStatus','cards'])ctx[id]=node(id);
 ctx.prompt=function nativePrompt(){};ctx.window=ctx;
 vm.createContext(ctx);
 for(const file of ['app.js','fix.js','customer.js'])vm.runInContext(readFileSync(new URL(file,import.meta.url),'utf8'),ctx);
 node('prompt').value='Correct textarea prompt';node('ratio').value='1:1';node('quality').value='low';
 await node('estimateBtn').onclick();
 assert.deepEqual(calls,[{action:'estimate',prompt:'Correct textarea prompt',aspectRatio:'1:1',quality:'low',includeQa:true}]);
 assert.match(node('approval').innerHTML,/Approval required/);
 assert.match(node('approval').innerHTML,/0\.012/);
 assert.equal(calls.length,1,'preflight cannot submit paid generation');
});
