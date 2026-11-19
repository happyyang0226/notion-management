// Server-only Notion reader. Never return API tokens, unapproved long-form fields or raw Notion rows.
const VERSION="2025-09-03";
const CORE={nodes:"41d4bfd4-2eb4-817a-8b79-000b0aa2c8ac",edges:"41d4bfd4-2eb4-8135-84a8-000b82da46c9"};
const SOURCES=[
 {code:"01",id:"41c4bfd4-2eb4-81d9-9ae6-000b764a437b",kind:"프로젝트",title:"프로젝트명",state:"상태"},
 {code:"02",id:"41c4bfd4-2eb4-8197-81ef-000bfab0d677",kind:"작업",title:"작업명",state:"상태"},
 {code:"03",id:"41c4bfd4-2eb4-818b-8574-000b47f83a49",kind:"코드",title:"변경 제목",state:"검증 상태"},
 {code:"04",id:"41c4bfd4-2eb4-81e0-92a4-000b9724a147",kind:"오류",title:"오류 제목",state:"상태"},
 {code:"05",id:"41c4bfd4-2eb4-81da-8801-000b2cfe99da",kind:"AI 세션",title:"세션 제목",state:"검증 상태"},
 {code:"06",id:"41c4bfd4-2eb4-8116-9db0-000b6bfa9f0b",kind:"자료",title:"자료명",state:"검증 상태"},
 {code:"07",id:"41c4bfd4-2eb4-817e-ae89-000b38e3be70",kind:"배포",title:"배포/연동명",state:"상태"},
 {code:"08",id:"41c4bfd4-2eb4-81d1-b3cf-000b9154305e",kind:"결정",title:"결정 제목",state:"승인 상태"}
];
function value(page,key){
 const v=page.properties?.[key]||{};
 if(v.type==="title")return (v.title||[]).map(x=>x.plain_text||"").join("");
 if(v.type==="rich_text")return (v.rich_text||[]).map(x=>x.plain_text||"").join("");
 if(v.type==="select")return v.select?.name||"";
 if(v.type==="status")return v.status?.name||"";
 if(v.type==="relation")return (v.relation||[]).map(x=>x.id);
 return "";
}
async function query(id,token){
 const items=[];let cursor;
 do{
  const r=await fetch("https://api.notion.com/v1/data_sources/"+id+"/query",{
   method:"POST",headers:{"Authorization":"Bearer "+token,"Notion-Version":VERSION,"Content-Type":"application/json"},
   body:JSON.stringify({page_size:100,...(cursor?{start_cursor:cursor}:{})})
  });
  if(!r.ok)throw Error("HTTP "+r.status);
  const body=await r.json();items.push(...(body.results||[]));
  if(items.length>1000)throw Error("limit_exceeded");
  cursor=body.has_more?body.next_cursor:null;
 }while(cursor);
 return items;
}
module.exports=async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).json({error:"method_not_allowed"});
 const {NOTION_API_KEY,GRAPH_VIEW_KEY}=process.env;
 if(!NOTION_API_KEY||!GRAPH_VIEW_KEY)return res.status(503).json({error:"not_configured"});
 if(req.headers.authorization!=="Bearer "+GRAPH_VIEW_KEY)return res.status(401).json({error:"unauthorized"});
 try{
  const [rawNodes,rawEdges]=await Promise.all([query(CORE.nodes,NOTION_API_KEY),query(CORE.edges,NOTION_API_KEY)]);
  const idMap=new Map(rawNodes.map(n=>[n.id,value(n,"노드 ID")||n.id]));
  const nodes=rawNodes.map(n=>({id:idMap.get(n.id),title:value(n,"지식 제목"),summary:value(n,"요약"),type:value(n,"유형")||"지식",status:value(n,"검증 상태"),url:n.url,source:"09"}));
  const edges=rawEdges.map(e=>({id:value(e,"관계 ID")||e.id,source:idMap.get(value(e,"시작 노드")[0]),target:idMap.get(value(e,"끝 노드")[0]),type:value(e,"관계 유형"),description:value(e,"관계 설명"),url:e.url})).filter(e=>e.source&&e.target);
  // Optional sources fail independently; an inaccessible source must not break the verified 09/10 graph.
  const responses=await Promise.allSettled(SOURCES.map(s=>query(s.id,NOTION_API_KEY)));
  const warnings=[];const rowsByCode={};
  responses.forEach((r,i)=>{
   const s=SOURCES[i];
   if(r.status==="fulfilled")rowsByCode[s.code]=r.value;
   else{rowsByCode[s.code]=[];warnings.push(s.code+" "+s.kind+": 접근 불가 또는 조회 실패");}
  });
  const projectIds=new Map((rowsByCode["01"]||[]).map(p=>[p.id,"db01:"+p.id]));
  for(const source of SOURCES){
   for(const page of rowsByCode[source.code]){
    const id="db"+source.code+":"+page.id;
    const state=value(page,source.state);
    nodes.push({id,title:value(page,source.title)||"(제목 없음)",summary:"Notion "+source.code+" "+source.kind+" 항목",type:source.kind,status:state,url:page.url,source:source.code,...(source.code==="05"?{workId:value(page,"작업 ID"),agent:value(page,"사용 AI")}:{})});
    if(source.code!=="01"){
     const projectRefs=value(page,"프로젝트");
     for(const pid of Array.isArray(projectRefs)?projectRefs:[]){
      const target=projectIds.get(pid);
      if(target)edges.push({id:"project:"+id+":"+pid,source:id,target,type:"프로젝트 소속",description:"Notion 프로젝트 관계",url:page.url});
     }
    }
   }
  }
  // Link knowledge items to their project through Notion's explicit relation only.
  for(const n of rawNodes){
   const source=idMap.get(n.id);
   const projects=value(n,"프로젝트");
   for(const pid of Array.isArray(projects)?projects:[]){
    const target=projectIds.get(pid);
    if(target)edges.push({id:"knowledge:"+n.id+":"+pid,source,target,type:"프로젝트 지식",description:"Notion 지식 노드 프로젝트 관계",url:n.url});
   }
  }
  res.status(200).json({meta:{mode:"live",capturedOn:new Date().toISOString(),sources:["09","10",...SOURCES.map(s=>s.code)],warnings},nodes,edges});
 }catch(err){
  // Never expose Notion credentials or backend exception bodies to clients.
  res.status(502).json({error:"notion_fetch_failed"});
 }
};
