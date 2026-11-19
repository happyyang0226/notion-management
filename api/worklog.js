// ChatGPT worklog endpoint. No access is granted by GRAPH_VIEW_KEY.
// Requires a dedicated, independent WORKLOG_WRITE_KEY configured in Vercel Production.
const {timingSafeEqual}=require("node:crypto");
const VERSION="2025-09-03";
const PROJECTS="41c4bfd4-2eb4-81d9-9ae6-000b764a437b";
const SESSIONS="41c4bfd4-2eb4-81da-8801-000b2cfe99da";
function safeEq(a,b){if(typeof a!=="string"||typeof b!=="string")return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)}
function readRich(p,name){const v=p.properties?.[name]||{};return (v.title||v.rich_text||[]).map(x=>x.plain_text||x.text?.content||"").join("")}
function fail(res,status,error){return res.status(status).json({error})}
async function notion(path,token,options={}){
 const r=await fetch("https://api.notion.com/v1/"+path,{...options,headers:{"Authorization":"Bearer "+token,"Notion-Version":VERSION,"Content-Type":"application/json",...(options.headers||{})},signal:AbortSignal.timeout(8500)});
 if(!r.ok)throw new Error("notion_http_"+r.status);
 return r.json();
}
async function list(id,token){
 let result=[],cursor;
 do{
  const page=await notion("data_sources/"+id+"/query",token,{method:"POST",body:JSON.stringify({page_size:100,...cursor?{start_cursor:cursor}:{}})});
  result.push(...(page.results||[]));
  if(result.length>1000)throw Error("scan_limit");
  cursor=page.has_more?page.next_cursor:null;
 }while(cursor);
 return result;
}
function rt(x){return [{type:"text",text:{content:x}}]}
function validate(v){
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const required=["taskId","projectId","title","instruction","result","handoff","date","verification"];
 const limits={taskId:90,title:160,instruction:1000,result:1800,handoff:1200,date:10,verification:10,projectId:36,sourceUrl:800};
 for(const k of required)if(typeof v[k]!=="string"||!v[k].trim()||v[k].length>limits[k])return false;
 if(!/^[A-Z0-9][A-Z0-9-]{8,89}$/.test(v.taskId))return false;
 if(!/^[0-9a-f-]{36}$/i.test(v.projectId))return false;
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(v.date)||Number.isNaN(Date.parse(v.date+"T00:00:00Z")))return false;
 if(!["확인됨","부분 확인","미검증"].includes(v.verification))return false;
 if(v.sourceUrl!==undefined&&(typeof v.sourceUrl!=="string"||v.sourceUrl.length>limits.sourceUrl||v.sourceUrl&&!/^https:\/\//.test(v.sourceUrl)))return false;
 return true;
}
module.exports=async function handler(req,res){
 res.setHeader("Cache-Control","no-store");res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="POST")return fail(res,405,"method_not_allowed");
 if(!process.env.WORKLOG_WRITE_KEY||!process.env.NOTION_API_KEY)return fail(res,503,"write_not_configured");
 // Requests from this site's own form only. This is an additional control, not authentication.
 const origin=req.headers.origin;
 if(origin){try{if(new URL(origin).host!==req.headers.host)return fail(res,403,"origin_mismatch")}catch{return fail(res,403,"origin_mismatch")}}
 const bearer=(req.headers.authorization||"").replace(/^Bearer /,"");
 if(!safeEq(bearer,process.env.WORKLOG_WRITE_KEY)||safeEq(bearer,process.env.GRAPH_VIEW_KEY||""))return fail(res,401,"unauthorized");
 let body=req.body;
 if(typeof body==="string"){if(body.length>12000)return fail(res,413,"too_large");try{body=JSON.parse(body)}catch{return fail(res,400,"invalid_json")}}
 if(JSON.stringify(body||{}).length>12000||!["check","save"].includes(body?.action)||!validate(body?.record))return fail(res,400,"invalid_request");
 if(body.action==="save"&&body.approved!==true)return fail(res,400,"approval_required");
 try{
  const records=await list(SESSIONS,process.env.NOTION_API_KEY);
  const duplicates=records.filter(p=>readRich(p,"작업 ID")===body.record.taskId);
  if(duplicates.length>1)return fail(res,409,"duplicate_conflict");
  if(duplicates.length===1)return res.status(200).json({status:"existing",url:duplicates[0].url,taskId:body.record.taskId});
  const projects=await list(PROJECTS,process.env.NOTION_API_KEY);
  if(!projects.some(p=>p.id===body.record.projectId))return fail(res,400,"project_not_found");
  if(body.action==="check")return res.status(200).json({status:"new",taskId:body.record.taskId});
  const v=body.record;
  const properties={
   "세션 제목":{title:rt(v.title)},"작업 ID":{rich_text:rt(v.taskId)},
   "사용 AI":{select:{name:"ChatGPT"}},"모델":{rich_text:rt("GPT-6")},
   "작업 날짜":{date:{start:v.date}},"프로젝트":{relation:[{id:v.projectId}]},
   "검증 상태":{select:{name:v.verification}},
   "지시문":{rich_text:rt(v.instruction)},"결과 요약":{rich_text:rt(v.result)},
   "인계 내용":{rich_text:rt(v.handoff)}
  };
  if(v.sourceUrl)properties["원본 대화"]={url:v.sourceUrl};
  const created=await notion("pages",process.env.NOTION_API_KEY,{method:"POST",body:JSON.stringify({parent:{type:"data_source_id",data_source_id:SESSIONS},properties,children:[]})});
  if(!created?.id||!created.url)throw Error("invalid_create_response");
  // Verify persisted ID and relation, not merely the HTTP create result.
  const stored=await notion("pages/"+created.id,process.env.NOTION_API_KEY);
  const validId=readRich(stored,"작업 ID")===v.taskId;
  const linked=(stored.properties?.["프로젝트"]?.relation||[]).some(p=>p.id===v.projectId);
  if(!validId||!linked)return res.status(200).json({status:"created_unverified",url:created.url,taskId:v.taskId});
  return res.status(200).json({status:"created_verified",url:created.url,taskId:v.taskId});
 }catch(e){
  // Fail closed, never retry a failed write automatically: creation may have succeeded.
  return fail(res,502,"notion_operation_unverified");
 }
};