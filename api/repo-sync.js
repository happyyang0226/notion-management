// GitHub -> Notion project registration. Explicit preview and approved batch creation only.
// The private WORKLOG_WRITE_KEY authenticates the operator; GRAPH_VIEW_KEY cannot write.
const {timingSafeEqual}=require("node:crypto");
const VERSION="2025-09-03";
const PROJECT_DB="41c4bfd4-2eb4-81d9-9ae6-000b764a437b";
const OWNER="happyyang0226";
function equal(a,b){if(typeof a!=="string"||typeof b!=="string")return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
function message(res,status,error){return res.status(status).json({error})}
function prop(p,k){const v=p.properties?.[k]||{};if(v.type==="title"||v.type==="rich_text")return (v.title||v.rich_text||[]).map(x=>x.plain_text||"").join("");if(v.type==="url")return v.url||"";return ""}
async function getJson(url,options){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(8500)});
 if(!r.ok)throw new Error("upstream_status_"+r.status);
 return r.json();
}
async function notion(path,token,body){
 return getJson("https://api.notion.com/v1/"+path,{
  method:body?"POST":"GET",
  headers:{"Authorization":"Bearer "+token,"Notion-Version":VERSION,"Content-Type":"application/json"},
  ...(body?{body:JSON.stringify(body)}:{})
 });
}
async function projects(token){
 let rows=[],cursor;do{
  const body=await notion("data_sources/"+PROJECT_DB+"/query",token,{page_size:100,...(cursor?{start_cursor:cursor}:{})});
  rows.push(...(body.results||[]));if(rows.length>1000)throw Error("notion_scan_limit");
  cursor=body.has_more?body.next_cursor:null;
 }while(cursor);return rows;
}
// Known private repository allowlist is for discovery only. GitHub grants access according to the token's actual scope.
const PRIVATE_REPO_CANDIDATES=["pt-exam-app","question-bank","pt-exercise","pt-anatomy","pt-msk-diagnosis","pt-kine-eval-lab"];
function publicRepo(r){return r&&r.owner?.login?.toLowerCase()===OWNER&&r.name&&r.full_name}
async function repos(){
 const token=process.env.GITHUB_SYNC_TOKEN||"";
 const baseHeaders={"Accept":"application/vnd.github+json","User-Agent":"second-brain-github-notion-sync","X-GitHub-Api-Version":"2022-11-28"};
 const headers=token?{...baseHeaders,Authorization:"Bearer "+token}:baseHeaders;
 // Public repos must stay visible even if a fine-grained token cannot call /user/repos.
 const publicList=await getJson("https://api.github.com/users/"+OWNER+"/repos?per_page=100&type=owner&page=1",{headers:baseHeaders});
 if(!Array.isArray(publicList))throw new Error("github_public_invalid");
 const rows=new Map(publicList.filter(publicRepo).map(r=>[r.full_name.toLowerCase(),r]));
 let privateStatus="not_configured";
 if(token){
  // Fine-grained PATs can be restricted in which listing endpoints they can access.
  // Individual /repos/{owner}/{repo} reads respect the selected repository scope.
  const results=await Promise.all(PRIVATE_REPO_CANDIDATES.map(async name=>{
   try{
    const r=await getJson("https://api.github.com/repos/"+OWNER+"/"+name,{headers});
    return {name,result:r};
   }catch(e){return {name,error:String(e.message||e)};}
  }));
  const success=results.filter(x=>x.result&&publicRepo(x.result));
  for(const x of success)rows.set(x.result.full_name.toLowerCase(),x.result);
  const denied=results.filter(x=>x.error);
  privateStatus=denied.length===0?"all_selected_accessible":"partial_or_denied";
  if(success.length===0)privateStatus="no_private_access";
  // Never claim the 6 private repositories were checked when the credential was rejected.
  if(privateStatus==="no_private_access"){
   const codes=[...new Set(denied.map(x=>(x.error.match(/upstream_status_\\d{3}/)||[])[0]||"unreachable"))];
   return {items:[...rows.values()].map(r=>({name:r.name,fullName:r.full_name,url:r.html_url||"https://github.com/"+r.full_name,private:!!r.private,archived:!!r.archived,description:(r.description||"").slice(0,350)})),
    visibility:"public_repositories_only",privateStatus,codes};
  }
 }
 return {items:[...rows.values()].map(r=>({name:r.name,fullName:r.full_name,url:r.html_url||"https://github.com/"+r.full_name,private:!!r.private,archived:!!r.archived,description:(r.description||"").slice(0,350)})),
  visibility:token?"authenticated_owner_repositories":"public_repositories_only",privateStatus};
}
function compare(repo,rows){
 const low=x=>String(x||"").trim().replace(/\/+$/,"").toLowerCase();
 return rows.find(p=>low(prop(p,"프로젝트 ID"))===low(repo.name)||
  low(prop(p,"프로젝트명"))===low(repo.name)||
  (prop(p,"GitHub")&&low(prop(p,"GitHub"))===low(repo.url)));
}
const rich=x=>[{type:"text",text:{content:String(x)}}];
module.exports=async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="POST")return message(res,405,"method_not_allowed");
 const {WORKLOG_WRITE_KEY,GRAPH_VIEW_KEY,NOTION_API_KEY}=process.env;
 if(!WORKLOG_WRITE_KEY||!NOTION_API_KEY)return message(res,503,"sync_not_configured");
 const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)return message(res,403,"origin_mismatch")}catch{return message(res,403,"origin_mismatch")}}
 const bearer=(req.headers.authorization||"").replace(/^Bearer /,"");
 if(!equal(bearer,WORKLOG_WRITE_KEY)||equal(bearer,GRAPH_VIEW_KEY||""))return message(res,401,"unauthorized");
 let body=req.body;if(typeof body==="string"){try{body=JSON.parse(body)}catch{return message(res,400,"invalid_json")}}
 if(!body||!["preview","register"].includes(body.action))return message(res,400,"invalid_request");
 if(body.action==="register"&&body.approved!==true)return message(res,400,"approval_required");
 if(body.action==="register"&&(!Array.isArray(body.selected)||body.selected.length===0||body.selected.length>5||
 body.selected.some(x=>typeof x!=="string"||!new RegExp("^"+OWNER+"/[A-Za-z0-9_.-]+$","i").test(x))||
 new Set(body.selected.map(x=>x.toLowerCase())).size!==body.selected.length))return message(res,400,"invalid_selection");
 try{
  const results=await Promise.allSettled([repos(),projects(NOTION_API_KEY)]);
  if(results[0].status==="rejected"){
   const raw=String(results[0].reason?.message||"");
   const code=(raw.match(/upstream_status_(\\d{3})/)||[])[1];
   return message(res,502,code==="401"?"github_auth_failed":code==="403"?"github_permission_or_rate_limit":code==="404"?"github_endpoint_not_found":"github_fetch_failed");
  }
  if(results[1].status==="rejected"){
   const raw=String(results[1].reason?.message||"");
   const code=(raw.match(/upstream_status_(\\d{3})/)||[])[1];
   return message(res,502,code==="401"||code==="403"?"notion_permission_failed":"notion_fetch_failed");
  }
  const [github,existing]=results.map(x=>x.value);
  const mapped=github.items.map(r=>{const p=compare(r,existing);return {...r,match:p?{title:prop(p,"프로젝트명"),url:p.url}:null}});
  if(body.action==="preview"){
   return res.status(200).json({visibility:github.visibility,privateStatus:github.privateStatus,privateCodes:github.codes||[],githubCount:mapped.length,notionCount:existing.length,
    existing:mapped.filter(r=>r.match),missing:mapped.filter(r=>!r.match)});
  }
  const byName=new Map(mapped.map(r=>[r.fullName.toLowerCase(),r]));
  const requested=body.selected.map(x=>byName.get(x.toLowerCase()));
  if(requested.some(x=>!x))return message(res,409,"repo_not_in_fresh_scan");
  let created=[],skipped=[],errors=[];
  for(const r of requested){
   // Read again before each write; if unavailable, fail closed.
   let fresh;
   try{fresh=await projects(NOTION_API_KEY)}catch{errors.push({name:r.name,error:"notion_check_failed"});break;}
   const match=compare(r,fresh);
   if(match){skipped.push({name:r.name,url:match.url});continue;}
   try{
    const description="GitHub 저장소 비교를 통해 등록됨. 실제 기능 구현·배포 상태는 검증되지 않음."+(r.description?" 저장소 설명: "+r.description:"");
    const payload={parent:{type:"data_source_id",data_source_id:PROJECT_DB},
     properties:{"프로젝트명":{title:rich(r.name)},"프로젝트 ID":{rich_text:rich(r.name)},
      "GitHub":{url:r.url},"분류":{select:{name:"웹개발"}},"상태":{status:{name:"계획"}},
      "설명":{rich_text:rich(description)}}};
    const result=await notion("pages",NOTION_API_KEY,payload);
    if(!result.id||!result.url)throw Error("create_unverified");
    // Re-read exact item to verify data persisted.
    const saved=await notion("pages/"+result.id,NOTION_API_KEY);
    const valid=prop(saved,"프로젝트 ID").toLowerCase()===r.name.toLowerCase()&&prop(saved,"GitHub").toLowerCase()===r.url.toLowerCase();
    created.push({name:r.name,url:result.url,verified:valid});
   }catch(e){errors.push({name:r.name,error:"write_unverified_stop_recheck"});break;}
  }
  return res.status(200).json({created,skipped,errors,visibility:github.visibility,remainingUnprocessed:requested.length-created.length-skipped.length-errors.length});
 }catch(e){
  return message(res,502,"repo_or_notion_scan_failed");
 }
};
