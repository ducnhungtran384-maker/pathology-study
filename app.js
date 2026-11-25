'use strict';
(() => {
const DATA=window.PATHOLOGY_DATA||{questions:[],audit:{}};
const Q=DATA.questions.filter(q=>q.review!=='uncertain'), BY_ID=Object.fromEntries(Q.map(q=>[q.id,q]));
const KEY='pathology-sprint-v1', COLORS=['#ffd268','#64dce8','#ff9cc4'];
const $=s=>document.querySelector(s), main=$('#main');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=()=>({version:1,records:{},bookmarks:[],session:null,prefs:{kind:'全部',includeExtension:false}});
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
let state=fresh(),view='practice',activeSession=null,showMarks=true,atlasPage=0,search='',atlasKind='全部';
let reviewOrigin=null,atlasDetailId=null;
let cloud=null,cloudBooting=true,cloudBusy=false,cloudAccount={connected:false,code:''},cloudStatus={state:'disabled',message:''},cloudBackupItems=[];
try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw?.version===1)state=validateState(raw)}catch(e){}
function validateState(raw){const out=fresh();for(const [id,r] of Object.entries(raw.records||{})){if(BY_ID[id]&&r&&typeof r==='object'){const attempts=Math.min(100000,Math.max(0,Math.floor(Number(r.attempts)||0)));out.records[id]={attempts,correct:Math.min(attempts,Math.max(0,Math.floor(Number(r.correct)||0))),streak:Math.min(attempts,Math.max(0,Math.floor(Number(r.streak)||0))),lastCorrect:r.lastCorrect===true,lastAt:typeof r.lastAt==='string'?r.lastAt:''}}}out.bookmarks=Array.isArray(raw.bookmarks)?[...new Set(raw.bookmarks.filter(id=>BY_ID[id]))]:[];if(['全部','大体','镜下'].includes(raw.prefs?.kind))out.prefs.kind=raw.prefs.kind;out.prefs.includeExtension=raw.prefs?.includeExtension===true;let s=raw.session;if(s&&Array.isArray(s.ids)){const ids=s.ids.filter(id=>BY_ID[id]);s={...s,ids,index:Math.max(0,ids.indexOf(s.ids[s.index]))}}if(s&&Array.isArray(s.ids)&&s.ids.length&&new Set(s.ids).size===s.ids.length&&s.ids.every(id=>BY_ID[id])&&s.options&&typeof s.options==='object'){const valid=s.ids.every(id=>Array.isArray(s.options[id])&&s.options[id].length===4&&new Set(s.options[id]).size===4&&s.options[id].every(t=>BY_ID[id].options.some(o=>o.text===t)));if(valid){out.session={ids:s.ids,options:s.options,answers:{},index:Math.max(0,Math.min(s.ids.length-1,Math.floor(Number(s.index)||0))),mode:s.mode==='exam'?'exam':'learn',done:s.done===true,started:typeof s.started==='string'?s.started:''};for(const id of s.ids){const a=s.answers?.[id];if(a&&(a.choice===null||s.options[id].includes(a.choice)))out.session.answers[id]={choice:a.choice,correct:a.choice===BY_ID[id].name,peek:a.peek===true,recorded:a.recorded===true}}}}if(out.session?.done&&out.session.ids.some(id=>!out.session.answers[id]))out.session=null;if(out.session)out.prefs.kind=sessionKind(out.session);return out}
function save(notifyCloud=true){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){$('#storage-note').textContent='浏览器未允许保存；离开前请导出进度。';toast('当前浏览器无法保存进度，请到“更多”导出备份。')}syncNav();if(notifyCloud&&cloud&&!cloudBooting)cloud.noteChange()}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2800)}
function confirmAction(message){return new Promise(resolve=>{const d=$('#confirm-dialog');$('#confirm-message').textContent=message;const finish=v=>{d.close();d.oncancel=null;resolve(v)};$('#confirm-yes').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);d.oncancel=e=>{e.preventDefault();finish(false)};d.showModal()})}
function syncNav(){$('#nav-wrong').textContent=Object.values(state.records).filter(r=>r.attempts&&!r.lastCorrect).length;$('#saved-count').textContent=state.bookmarks.length+' 题';document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view))}
function sessionKind(s){const kinds=new Set(s.ids.map(id=>BY_ID[id].kind));return kinds.size===1?[...kinds][0]:'全部'}
function pool(){return Q.filter(q=>(state.prefs.includeExtension||q.scope!=='extension')&&(state.prefs.kind==='全部'||q.kind===state.prefs.kind))}
function sourceLabel(q){const s=q.source||{};return `${s.file||'课程资料'}${s.page?' · 第 '+s.page+' 页':''}${s.question?' · 原题 '+s.question:''}`}
function top(title,sub){return `<div class="page-top"><h1 tabindex="-1">${title}</h1><p>${sub}</p></div>`}
function setImageError(){main.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.alt='图片加载失败，请使用完整文件或单文件离线版';img.style.minHeight='120px'},{once:true}))}
function navigate(v){clearOptionRoute();view=v;atlasPage=0;showMarks=true;syncNav();if(v==='practice'){if(state.session&&!state.session.done){activeSession=state.session;renderQuestion()}else startSession(pool())}else if(v==='atlas')renderAtlas();else if(v==='audit')renderAudit();else renderCollection();window.scrollTo(0,0)}
async function startSession(items,sessionMode='learn',amount=20,skipConfirm=false){if(!items.length){toast('当前范围没有题目。');return false}if(!skipConfirm&&state.session&&!state.session.done&&state.session.mode==='exam'&&Object.keys(state.session.answers).length){if(!await confirmAction('这组自测尚未交卷，切换后本组自测答案不会计入成绩。确认切换？'))return false}clearOptionRoute();let arr=shuffle(items);arr.sort((a,b)=>(state.records[a.id]?.attempts||0)-(state.records[b.id]?.attempts||0));arr=arr.slice(0,amount);activeSession={ids:arr.map(q=>q.id),options:Object.fromEntries(arr.map(q=>[q.id,shuffle(q.options.map(o=>o.text))])),answers:{},index:0,mode:sessionMode,started:new Date().toISOString(),done:false};state.session=activeSession;state.prefs.kind=sessionKind(activeSession);view='practice';showMarks=true;save();renderQuestion();window.scrollTo(0,0);return true}
function record(id,a){if(a.recorded)return;const r=state.records[id]||{attempts:0,correct:0,streak:0};r.attempts++;if(a.correct){r.correct++;r.streak++}else r.streak=0;r.lastCorrect=a.correct;r.lastAt=new Date().toISOString();state.records[id]=r;a.recorded=true}
function answer(choice){const s=activeSession;if(!s||s.done)return;const id=s.ids[s.index],q=BY_ID[id];if(s.mode==='learn'&&s.answers[id])return;const a={choice,correct:choice===q.name,peek:choice===null,recorded:false};s.answers[id]=a;if(s.mode==='learn')record(id,a);state.session=s;showMarks=true;save();renderQuestion()}
function figure(q,visible){const marks=q.annotations?.marks||[],ratio=(q.imageWidth||1)/(q.imageHeight||1);return `<div class="figure" style="--ratio:${ratio}" data-image-id="${esc(q.id)}"><img src="${esc(q.image)}" alt="病理标本图" draggable="false">${visible&&marks.length?`<svg class="annotation-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${marks.map((m,i)=>`<ellipse cx="${m.x}" cy="${m.y}" rx="${m.rx}" ry="${m.ry}" fill="none" stroke="#183743" stroke-width="5" vector-effect="non-scaling-stroke"/><ellipse cx="${m.x}" cy="${m.y}" rx="${m.rx}" ry="${m.ry}" fill="none" stroke="${COLORS[i%3]}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join('')}</svg>${marks.map((m,i)=>`<span class="mark-number" aria-hidden="true" style="left:${Math.max(3,Math.min(97,m.x-m.rx*.7))}%;top:${Math.max(4,Math.min(96,m.y-m.ry*.7))}%;--mark:${COLORS[i%3]}">${i+1}</span>`).join('')}`:''}</div>`}
function legend(q){const a=q.annotations;if(!a)return '<div class="image-foot">本图标注正在核对。</div>';return `<div class="annotation-legend">${a.marks.map((m,i)=>`<div class="legend-item"><span class="legend-number" style="--mark:${COLORS[i%3]}">${i+1}</span><div><b>${esc(m.label)}</b><p>${esc(m.detail)}</p></div></div>`).join('')}<p class="annotation-note">${a.marks.length?'圈选表示观察区域，不是病灶边界。':''}${a.note?' '+esc(a.note):''}</p></div>`}
function imagePanel(q,revealed){const has=q.annotations?.marks?.length;return `<section class="image-panel"><div class="image-top"><span class="pill">${q.kind==='镜下'?'显微玻片':'大体标本'}</span><div class="image-tools">${revealed&&has?`<button class="quiet" id="toggle-marks">${showMarks?'隐藏标注':'显示标注'}</button>`:''}<button class="quiet" id="zoom">放大</button></div></div><div class="image-wrap" id="image-open" role="button" tabindex="0" aria-label="放大标本图">${figure(q,revealed&&showMarks)}</div>${revealed?legend(q):'<div class="image-foot">点击图片可放大 · 作答后显示识别标注</div>'}</section>`}
function bindImage(q,revealed,rerender){$('#zoom').onclick=$('#image-open').onclick=()=>openZoom(q,revealed);$('#image-open').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();openZoom(q,revealed)}};if($('#toggle-marks'))$('#toggle-marks').onclick=()=>{showMarks=!showMarks;rerender()}}
function optionHref(q,text){return '#option/'+encodeURIComponent(q.id)+'/'+q.options.findIndex(o=>o.text===text)}
function optionTarget(q,text){
  // Only exact names are equivalent; similar diagnoses and stages must stay separate.
  return Q.filter(item=>item.name===text).sort((a,b)=>Number(b.kind===q.kind)-Number(a.kind===q.kind)||Number(a.scope==='extension')-Number(b.scope==='extension'))[0]||null;
}
function optionLink(q,text,cls='option-link'){return `<a class="${cls}" data-option-link href="${optionHref(q,text)}">${esc(text)}<span class="link-arrow" aria-hidden="true"> ↗</span></a>`}
function renderOption(q,text,i,a,revealed){
  let cls='',badge='';
  if(revealed){if(text===q.name){cls='correct';badge='正确答案'}else if(text===a?.choice){cls='wrong';badge='你的选择'}}else if(text===a?.choice)cls='chosen';
  const body=`<span class="option-letter">${'ABCD'[i]}</span><span>${revealed&&text!==q.name?optionLink(q,text):esc(text)}</span>${badge?`<span class="option-icon">${badge}</span>`:''}`;
  return revealed?`<div class="option answered ${cls}">${body}</div>`:`<button class="option ${cls}" data-option="${i}">${body}</button>`;
}
function explanation(q,a,atlas=false){return `<div class="answer-panel"><div class="answer-status ${!atlas&&!a?.correct?'incorrect':''}">${atlas?'识别结论':a?.peek?'已查看答案':a?.correct?'回答正确':'再辨认一次'} · ${esc(q.name)}</div><h3>识别要点</h3><ol class="points">${q.points.map((p,i)=>`<li>${i===0?'<strong>'+esc(p)+'</strong>':esc(p)}</li>`).join('')}</ol>${q.caution?`<div class="caution">${esc(q.caution)}</div>`:''}<section class="differences" aria-label="其他选项怎么排除"><h3>其他选项怎么排除</h3>${q.options.filter(o=>o.text!==q.name).map(o=>`<div class="diff-item"><b>${optionLink(q,o.text)}</b><p>${esc(o.reason)}</p></div>`).join('')}</section><div class="source">来源：${esc(sourceLabel(q))}${q.scope==='extension'?' · 拓展题':''}</div></div>`}
function clearOptionRoute(){
  reviewOrigin=null;atlasDetailId=null;
  if(location.hash.startsWith('#option/'))history.replaceState(null,'',location.pathname+location.search);
}
function captureReviewOrigin(){return {view,atlasDetailId,atlasPage,atlasKind,search,showMarks,questionId:view==='practice'?activeSession?.ids[activeSession.index]:null,sessionStarted:activeSession?.started,scrollY:window.scrollY,focusHref:document.activeElement?.getAttribute('href')||''}}
function restoreReviewOrigin(){
  const origin=reviewOrigin||history.state?.pathologyOrigin||{view:'practice'};
  reviewOrigin=null;showMarks=origin.showMarks!==false;
  atlasPage=origin.atlasPage||0;atlasKind=origin.atlasKind||'全部';search=origin.search||'';
  if(origin.view==='atlas'){
    view='atlas';syncNav();
    if(BY_ID[origin.atlasDetailId])renderAtlasDetail(BY_ID[origin.atlasDetailId]);else renderAtlas();
  }else if(state.session&&(!origin.questionId||state.session.started===origin.sessionStarted&&state.session.ids.includes(origin.questionId))){
    activeSession=state.session;
    if(origin.questionId){const index=activeSession.ids.indexOf(origin.questionId);if(activeSession.index!==index){activeSession.index=index;save()}}
    renderQuestion();
  }else if(BY_ID[origin.questionId]){view='atlas';syncNav();renderAtlasDetail(BY_ID[origin.questionId])}
  else navigate('practice');
  const link=[...main.querySelectorAll('[data-option-link]')].find(a=>a.getAttribute('href')===origin.focusHref);
  link?.focus({preventScroll:true});window.scrollTo(0,origin.scrollY||0);
}
function renderOptionRoute(){
  const match=location.hash.match(/^#option\/([^/]+)\/(\d+)$/);
  if(!match)return false;
  const q=BY_ID[match[1]],o=q?.options[Number(match[2])];
  if(!q||!o){history.replaceState(null,'',location.pathname+location.search);restoreReviewOrigin();toast('这条链接已失效，已返回复习页面。');return true}
  reviewOrigin=reviewOrigin||history.state?.pathologyOrigin||{view:'atlas',atlasDetailId:q.id,fromSharedLink:true};
  history.replaceState({pathologyOrigin:reviewOrigin},'');
  view='review';syncNav();
  const target=optionTarget(q,o.text),back=reviewOrigin.fromSharedLink?'查看原题':reviewOrigin.view==='atlas'?'返回速记':'返回原题';
  main.innerHTML=`<div class="section-head"><a class="review-back" href="#" data-review-back>← ${back}</a>${target?`<button id="detail-save" class="quiet">${state.bookmarks.includes(target.id)?'★ 已收藏':'☆ 收藏'}</button>`:''}</div>`+top(esc(o.text),target?esc(target.kind+' · '+target.system):'选项鉴别')+(target?`<div class="quiz-grid">${imagePanel(target,true)}<section class="question-panel">${explanation(target,null,true)}</section></div>`:`<section class="panel option-note"><h2>与原题怎么区分</h2><p>${esc(o.reason)}</p><p class="muted">此选项暂未配独立图片，以上为原题中的鉴别说明。</p><div class="source">原题：${esc(q.name)} · ${esc(sourceLabel(q))}</div></section>`);
  if(target){$('#detail-save').onclick=()=>{toggleBookmark(target.id);renderOptionRoute()};bindImage(target,true,renderOptionRoute)}
  setImageError();return true;
}
main.addEventListener('click',e=>{
  const link=e.target.closest('a[data-option-link]');
  if(!link||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  if(view!=='review'){reviewOrigin=captureReviewOrigin();reviewOrigin.focusHref=link.getAttribute('href');history.replaceState({pathologyOrigin:reviewOrigin},'')}
  showMarks=true;
});
window.addEventListener('hashchange',()=>{
  if(location.hash.startsWith('#option/')){renderOptionRoute();window.scrollTo(0,0);main.querySelector('h1')?.focus({preventScroll:true})}
  else if(view==='review')restoreReviewOrigin();
});
function renderQuestion(){const s=activeSession;if(!s)return;view='practice';syncNav();const id=s.ids[s.index],q=BY_ID[id],a=s.answers[id],revealed=(s.mode==='learn'&&!!a)||s.done;const seen=Q.filter(x=>(state.prefs.includeExtension||x.scope!=='extension')&&state.records[x.id]?.attempts).length,total=Q.filter(x=>state.prefs.includeExtension||x.scope!=='extension').length;
main.innerHTML=`<div class="practice-bar"><div class="kind-tabs" aria-label="题库类型">${['全部','大体','镜下'].map(k=>`<button data-kind="${k}" class="${state.prefs.kind===k?'active':''}">${k==='全部'?'混合':k}</button>`).join('')}</div><span class="session-count">${s.done?'复盘 · ':s.mode==='exam'?'自测 · ':''}<b>${s.index+1}</b> / ${s.ids.length}</span></div><div class="quiz-grid">${imagePanel(q,revealed)}<section class="question-panel"><h2>${esc(q.prompt||'图中最符合下列哪一项？')}</h2><p class="instruction">${s.done?'本组已完成，可逐题复盘。':s.mode==='exam'?'单选，可修改；交卷后显示解析与标注。':'选一项，查看识别要点。'}</p><div class="options">${s.options[id].map((text,i)=>renderOption(q,text,i,a,revealed)).join('')}</div><div class="question-actions"><button id="prev" ${s.index===0?'disabled':''}>上一题</button>${!a&&s.mode==='learn'&&!s.done?'<button id="peek" class="quiet">不会</button>':''}<button id="next" class="primary">${s.index===s.ids.length-1?(s.done?'返回成绩':s.mode==='exam'?'交卷':'完成本组'):'下一题'}</button></div>${revealed?explanation(q,a):''}</section></div><div class="bottom-progress"><span>已练 ${seen} / ${total} 题 · 未练题优先</span><div>${s.mode==='exam'&&!s.done?'<button id="submit" class="quiet">提前交卷</button> ':''}<button id="bookmark" class="quiet">${state.bookmarks.includes(id)?'★ 已收藏':'☆ 收藏'}</button>${s.done?' <button id="result" class="quiet">本组成绩</button>':''}</div></div>`;
main.querySelectorAll('[data-kind]').forEach(b=>b.onclick=async()=>{const k=b.dataset.kind;const old=state.prefs.kind;state.prefs.kind=k;if(!await startSession(pool()))state.prefs.kind=old});main.querySelectorAll('[data-option]').forEach(b=>b.onclick=()=>answer(s.options[id][Number(b.dataset.option)]));$('#bookmark').onclick=()=>{toggleBookmark(id);renderQuestion()};bindImage(q,revealed,renderQuestion);$('#prev').onclick=()=>jump(s.index-1);$('#next').onclick=()=>{if(s.index<s.ids.length-1)jump(s.index+1);else s.done?renderResults():finishSession()};if($('#peek'))$('#peek').onclick=()=>answer(null);if($('#submit'))$('#submit').onclick=finishSession;if($('#result'))$('#result').onclick=renderResults;setImageError()}
function toggleBookmark(id){state.bookmarks.includes(id)?state.bookmarks=state.bookmarks.filter(x=>x!==id):state.bookmarks.push(id);save()}
function jump(i){if(!activeSession||i<0||i>=activeSession.ids.length)return;activeSession.index=i;showMarks=true;save();renderQuestion();window.scrollTo(0,0)}
async function finishSession(){const s=activeSession;if(!s||s.done)return;const missing=s.ids.filter(id=>!s.answers[id]);if(missing.length&&!await confirmAction(`还有 ${missing.length} 题未答。结束后按未答计入错题，仍可查看解析。确认结束本组？`))return;for(const id of s.ids){if(!s.answers[id])s.answers[id]={choice:null,correct:false,peek:false,recorded:false};record(id,s.answers[id])}s.done=true;state.session=s;save();renderResults();window.scrollTo(0,0)}
function renderResults(){const s=activeSession;if(!s)return;view='practice';syncNav();const wrong=s.ids.filter(id=>!s.answers[id]?.correct),correct=s.ids.length-wrong.length;main.innerHTML=top('这一组练完了','先复习没认准的图，再继续覆盖未练题。')+`<section class="panel"><div class="result-score">${correct}<small> / ${s.ids.length} 题答对</small></div><p class="muted">${wrong.length?`${wrong.length} 题已加入错题，包括查看答案或未答的题。`:'本组全部答对。'}</p><div class="result-actions">${wrong.length?'<button class="primary" id="retry">只练本组错题</button>':''}<button id="next-group" class="${wrong.length?'':'primary'}">再练 20 题</button></div></section><section class="panel"><h2>逐题回看</h2>${s.ids.map((id,i)=>{const q=BY_ID[id],a=s.answers[id];return `<div class="collection-item"><img src="${esc(q.image)}" alt="${esc(q.name)}" loading="lazy"><div class="collection-info"><b>${a.correct?'✓':'✕'} ${esc(q.name)}</b><small>${esc(q.kind)} · ${a.choice?'作答：'+esc(a.choice):a.peek?'查看了答案':'未作答'}</small></div><button data-review="${i}">看解析</button></div>`}).join('')}</section>`;if($('#retry'))$('#retry').onclick=()=>startSession(wrong.map(id=>BY_ID[id]),'learn',wrong.length);$('#next-group').onclick=()=>startSession(pool());main.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>jump(Number(b.dataset.review)));setImageError()}
function renderCollection(){const wrong=view==='wrong',items=Q.filter(q=>wrong?state.records[q.id]?.attempts&&!state.records[q.id]?.lastCorrect:state.bookmarks.includes(q.id));syncNav();main.innerHTML=top(wrong?'错题':'我的收藏',wrong?'再次独立答对后，自动移出当前错题。':'收藏方便回看，不影响作答成绩。')+(items.length?`<section class="panel"><div class="section-head"><h2>${items.length} 题</h2><button class="primary" id="practice-collection">开始重练</button></div>${items.map(q=>`<div class="collection-item"><img src="${esc(q.image)}" alt="待复习标本" loading="lazy"><div class="collection-info"><b>${esc(q.name)}</b><small>${esc(q.kind)} · ${esc(q.system)}</small></div><button data-single="${q.id}">练这题</button>${!wrong?`<button class="quiet" data-remove="${q.id}">取消</button>`:''}</div>`).join('')}</section>`:`<div class="empty"><h2>${wrong?'当前没有错题':'还没有收藏'}</h2><p>${wrong?'不会或答错的题，会自动收集到这里。':'练习时点击图片下方的“收藏”。'}</p><button class="primary" id="back-practice">继续刷题</button></div>`);if($('#practice-collection'))$('#practice-collection').onclick=()=>startSession(items,'learn',items.length);if($('#back-practice'))$('#back-practice').onclick=()=>navigate('practice');main.querySelectorAll('[data-single]').forEach(b=>b.onclick=()=>startSession([BY_ID[b.dataset.single]],'learn',1));main.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{toggleBookmark(b.dataset.remove);renderCollection()});setImageError()}
function renderAtlas(){atlasDetailId=null;view='atlas';syncNav();const items=Q.filter(q=>(state.prefs.includeExtension||q.scope!=='extension')&&(atlasKind==='全部'||q.kind===atlasKind)&&(!search||[q.name,q.system,...q.points].join(' ').includes(search)));const per=12,pages=Math.max(1,Math.ceil(items.length/per));atlasPage=Math.min(atlasPage,pages-1);main.innerHTML=top('识别速记','点击图片，查看标注与识别要点。此处直接显示病名。')+`<div class="search-bar"><input id="atlas-search" type="search" value="${esc(search)}" placeholder="搜病名或特征：新月体、假小叶……" aria-label="搜索病名或特征"><select id="atlas-kind" aria-label="图片类型">${['全部','大体','镜下'].map(k=>`<option ${k===atlasKind?'selected':''}>${k}</option>`).join('')}</select></div><div class="atlas-grid">${items.slice(atlasPage*per,(atlasPage+1)*per).map(q=>`<article class="atlas-card"><button data-detail="${q.id}" aria-label="查看${esc(q.name)}的标注"><img src="${esc(q.image)}" alt="${esc(q.name)}" loading="lazy"><div class="atlas-body"><h3>${esc(q.name)}</h3><p>${esc(q.kind)} · ${esc(q.points[0])}</p></div></button></article>`).join('')}</div>${!items.length?'<div class="empty">没有匹配结果，试试更短的关键词。</div>':''}<div class="pagination"><button id="atlas-prev" ${atlasPage===0?'disabled':''}>上一页</button><span>${atlasPage+1} / ${pages} · ${items.length} 题</span><button id="atlas-next" ${atlasPage===pages-1?'disabled':''}>下一页</button></div>`;$('#atlas-search').oninput=e=>{search=e.target.value;atlasPage=0;const p=e.target.selectionStart;renderAtlas();$('#atlas-search').focus();$('#atlas-search').setSelectionRange(p,p)};$('#atlas-kind').onchange=e=>{atlasKind=e.target.value;atlasPage=0;renderAtlas()};$('#atlas-prev').onclick=()=>{atlasPage--;renderAtlas();window.scrollTo(0,0)};$('#atlas-next').onclick=()=>{atlasPage++;renderAtlas();window.scrollTo(0,0)};main.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{showMarks=true;renderAtlasDetail(BY_ID[b.dataset.detail]);window.scrollTo(0,0)});setImageError()}
function renderAtlasDetail(q){atlasDetailId=q.id;main.innerHTML=`<div class="section-head"><button id="atlas-back" class="quiet">← 返回速记</button><button id="detail-save" class="quiet">${state.bookmarks.includes(q.id)?'★ 已收藏':'☆ 收藏'}</button></div>`+top(esc(q.name),esc(q.kind+' · '+q.system))+`<div class="quiz-grid">${imagePanel(q,true)}<section class="question-panel">${explanation(q,null,true)}</section></div>`;$('#atlas-back').onclick=renderAtlas;$('#detail-save').onclick=()=>{toggleBookmark(q.id);renderAtlasDetail(q)};bindImage(q,true,()=>renderAtlasDetail(q));setImageError()}

function coverageHtml(entries){
const groups={};
for(const c of entries){const label=c.file||(c.group==='gross'?'病理标本.pdf':c.group==='slides'?'玻片Ⅰ.pdf':'其他资料');(groups[label]??=[]).push(c)}
const names={reviewed:'已核对',mapped_to_reviewed_bank:'已映射到核对题',paired_images_mapped:'配对关系已核对',uncertain:'证据不足，隔离',excluded:'不纳入练习',duplicate:'重复视野，合并',covered:'已覆盖',text_only:'文字题，不伪配图片'};
return `<section class="panel audit-copy"><h2>逐页、逐题覆盖记录</h2><p class="muted">展开资料名称可查看每一页或原题的处理方式。题号对应本题库；重复视野、正常对照与疑图不会机械地各出一道题。</p>${Object.entries(groups).map(([label,rows])=>`<details><summary>${esc(label)} · ${rows.length} 条记录</summary><div class="table-wrap coverage-table"><table><thead><tr><th>原位置</th><th>处理与对应题</th><th>核对说明</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${c.page?'第 '+esc(c.page)+' 页':'原题 '+esc(c.question||c.sourceQuestion||'—')}</td><td>${esc(names[c.status]||'已记录处理')}<small class="source" style="display:block">${(c.questionIds||c.ids||[]).map(id=>esc(BY_ID[id]?.name||id)).join('；')||'—'}</small></td><td>${esc(c.note||c.reason||c.detail||'详见纠错与疑图记录。')}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</section>`}
function renderAudit(){const a=DATA.audit||{},sources=a.sources||[],corrections=a.corrections||[],uncertain=a.exclusions||[];main.innerHTML=top('资料核对与纠错','保留出处、纠错依据和疑图边界；不把笔记里的每句话当成标准答案。')+`<section class="panel audit-copy"><h2>题库怎么整理</h2><p>${esc(a.summary||'以原始图像和图内标注核对病变。重复视野合并；标题、分型或图像证据冲突的内容单列待核实。')}</p><div class="row"><span class="pill">可练 ${Q.length} 题</span><span class="pill">大体 ${Q.filter(q=>q.kind==='大体').length} 题</span><span class="pill">镜下 ${Q.filter(q=>q.kind==='镜下').length} 题</span><span class="pill">旧网页拓展 ${Q.filter(q=>q.scope==='extension').length} 题</span></div><p class="muted">解析中的“典型表现”用于帮助辨别，不能把单一低清照片无法显示的结构说成已经看见。教学标本沿用课程病名；仅凭形态不足以确定的分型会特别标明。部分原图的答案性文字已遮挡，灰色块为遮挡区域；原始文件保留不变。</p><div class="table-wrap"><table><thead><tr><th>资料</th><th>审查范围</th><th>处理情况</th></tr></thead><tbody>${sources.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.range)}</td><td>${esc(s.note)}</td></tr>`).join('')}</tbody></table></div></section><section class="panel audit-copy"><h2>需要避免记错的地方</h2>${corrections.length?corrections.map(c=>`<details><summary>${esc(c.title||c.item||c.source||'资料纠正')}</summary><p>${esc(c.detail||c.correction||c.note||'')}</p>${c.source?`<div class="source">${esc(c.source)}</div>`:''}</details>`).join(''):'<p>详细审查记录见交付文件中的题库审查报告。</p>'}</section><section class="panel audit-copy"><h2>隔离的疑图与不计分内容</h2><p class="muted">这些条目未作为确定答案放进默认练习。没有证据时，保留“待核实”。</p>${uncertain.map(c=>`<details><summary>${esc(c.title||c.source||c.id||'待核实条目')}</summary><p>${esc(c.reason||c.note||c.detail||'')}</p></details>`).join('')||'<p>详见逐页覆盖记录。</p>'}</section>${coverageHtml(a.coverage||[])}<section class="panel audit-copy"><h2>核对参考</h2><ul class="points">${(a.references||[]).map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title||r.url)}</a>${r.note?' — '+esc(r.note):''}</li>`).join('')}</ul><p class="source">本页记录的是本次资料审查，不代表获得了任课老师对考试范围或答案的确认。</p></section>`}

function cloudAvailable(){return !!(window.PathologyCloud&&window.PATHOLOGY_CLOUD?.url&&window.PATHOLOGY_CLOUD?.key)}
function updateCloudUI(){
  const info=cloud?.getInfo()||{},connected=info.connected??cloudAccount.connected;
  const status=cloudStatus.state||'disabled',labels={disabled:'云同步',offline:'离线待同步',syncing:'同步中',synced:'已同步',conflict:'需选择进度',error:'同步未完成'};
  $('#cloud-status').textContent=labels[status]||'云同步';$('#cloud-open').dataset.status=status;
  $('#cloud-message').textContent=cloudStatus.message||(connected?'作答后会自动同步。换设备时输入同一同步码。':'开启后，作答、错题、收藏和当前题组会自动保存到云端。');
  $('#cloud-unavailable').hidden=cloudAvailable();$('#cloud-signed-out').hidden=connected||!cloudAvailable();$('#cloud-signed-in').hidden=!connected;
  $('#cloud-code').value=info.code||cloudAccount.code||'';$('#cloud-conflict').hidden=status!=='conflict'&&!info.conflict;
  cloudBackupItems=cloud?.getBackups?.()||[];$('#cloud-backups').hidden=!cloudBackupItems.length;
  const selected=$('#cloud-backup-select').value;
  $('#cloud-backup-select').innerHTML=cloudBackupItems.map((item,i)=>`<option value="${i}">${esc(new Date(item.at).toLocaleString('zh-CN'))} · ${esc(item.reason)}</option>`).join('');
  if(cloudBackupItems[Number(selected)])$('#cloud-backup-select').value=selected;
  $('#cloud-sync').disabled=cloudBusy||status==='syncing'||status==='conflict';
  for(const id of ['cloud-create','cloud-connect','cloud-disconnect','cloud-use-remote','cloud-use-local'])$('#'+id).disabled=cloudBusy;
  $('#storage-note').textContent=connected?'进度自动同步到云端；导出可另存一份备份。':'进度保存在当前浏览器。开启云同步后可在其他设备继续练习。';
}
function applyCloudState(raw){
  state=validateState(raw);activeSession=state.session;save(false);updateCloudUI();
  if(cloudBooting)return;
  const scrollY=window.scrollY;
  if(location.hash.startsWith('#option/')){
    if(reviewOrigin?.view==='practice'&&state.session?.ids.includes(reviewOrigin.questionId)){
      reviewOrigin.sessionStarted=state.session.started;history.replaceState({pathologyOrigin:reviewOrigin},'');
    }
    renderOptionRoute();
  }else if(view==='practice'){
    if(activeSession)renderQuestion();else navigate('practice');
  }else if(view==='atlas'){
    if(BY_ID[atlasDetailId])renderAtlasDetail(BY_ID[atlasDetailId]);else renderAtlas();
  }else if(view==='wrong'||view==='saved')renderCollection();
  window.scrollTo(0,scrollY);
}
async function cloudAction(action){
  if(!cloud||cloudBusy)return;cloudBusy=true;updateCloudUI();
  try{await action()}catch(e){toast(e?.message||'暂时无法连接云端，本机进度仍然保留。')}
  finally{cloudBusy=false;updateCloudUI()}
}
$('#cloud-open').onclick=()=>{updateCloudUI();$('#cloud-dialog').showModal()};$('#cloud-close').onclick=()=>$('#cloud-dialog').close();
$('#cloud-dialog').addEventListener('close',()=>{$('#cloud-code').type='password';$('#cloud-reveal').textContent='显示';$('#cloud-reveal').setAttribute('aria-label','显示同步码')});
$('#cloud-create').onclick=()=>cloudAction(async()=>{await cloud.connect();toast('云同步已开启，请保存你的同步码。')});
$('#cloud-connect').onclick=()=>cloudAction(async()=>{const code=$('#cloud-code-input').value.trim();if(!code){toast('请先粘贴另一台设备上的同步码。');return}await cloud.connect(code);$('#cloud-code-input').value='';if(!cloud.getInfo().conflict)toast('已连接，可以在这台设备继续练习。')});
$('#cloud-code-input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#cloud-connect').click()}};
$('#cloud-sync').onclick=()=>cloudAction(()=>cloud.sync());
$('#cloud-disconnect').onclick=()=>cloudAction(async()=>{await cloud.disconnect();$('#cloud-code').type='password';$('#cloud-reveal').textContent='显示';toast('已退出云同步，本机进度仍然保留。')});
$('#cloud-use-remote').onclick=()=>cloudAction(()=>cloud.resolve('cloud'));
$('#cloud-use-local').onclick=()=>cloudAction(()=>cloud.resolve('local'));
$('#cloud-backup-download').onclick=()=>{const item=cloudBackupItems[Number($('#cloud-backup-select').value)];if(item){downloadProgress(item.state,'历史备份');toast('备份已下载，可在“更多”中导入。')}};
$('#cloud-reveal').onclick=()=>{const input=$('#cloud-code'),visible=input.type==='password';input.type=visible?'text':'password';$('#cloud-reveal').textContent=visible?'隐藏':'显示';$('#cloud-reveal').setAttribute('aria-label',visible?'隐藏同步码':'显示同步码')};
$('#cloud-copy').onclick=async()=>{const input=$('#cloud-code');try{await navigator.clipboard.writeText(input.value);toast('同步码已复制，请只保存到自己的设备。')}catch(e){input.type='text';$('#cloud-reveal').textContent='隐藏';input.focus();input.select();toast('请复制已选中的同步码。')}};
async function initializeCloud(){
  let started=false;
  const start=()=>{if(started)return;started=true;cloudBooting=false;if(!renderOptionRoute()){if(state.session){activeSession=state.session;renderQuestion()}else navigate('practice')}};
  if(!cloudAvailable()){start();updateCloudUI();return}
  main.innerHTML=top('正在恢复学习进度','连接云端后，将继续上一次的题组。')+'<button id="cloud-start-local">先开始练习</button>';
  $('#cloud-start-local').onclick=start;
  try{
    cloud=window.PathologyCloud.create({getState:()=>state,applyState:applyCloudState,
      onStatus:status=>{cloudStatus=status;updateCloudUI();if(status.state==='conflict'&&!$('#cloud-dialog').open)$('#cloud-dialog').showModal()},
      onAccount:account=>{cloudAccount=account;updateCloudUI()}});
    updateCloudUI();await cloud.init();
  }catch(e){cloudStatus={state:'error',message:e?.message||'暂时无法连接云端，先使用本机进度。'};updateCloudUI()}
  finally{start()}
}

let zoom=1,zoomQuestion=null,zoomAllowed=false,zoomMarks=false;
function openZoom(q,allowed){zoom=1;zoomQuestion=q;zoomAllowed=allowed;zoomMarks=allowed&&showMarks;$('#zoom-title').textContent='查看标本';$('#zoom-dialog').showModal();updateZoom()}
function updateZoom(){if(!zoomQuestion)return;const stage=$('.zoom-stage'),q=zoomQuestion,ratio=(q.imageWidth||1)/(q.imageHeight||1),base=Math.min(stage.clientWidth-32,(stage.clientHeight-32)*ratio);$('#zoom-level').textContent=Math.round(zoom*100)+'%';$('#zoom-canvas').style.width=Math.max(1,base*zoom)+'px';$('#zoom-canvas').innerHTML=figure(q,zoomAllowed&&zoomMarks);$('#zoom-annotations').hidden=!(zoomAllowed&&q.annotations?.marks?.length);$('#zoom-annotations').textContent=zoomMarks?'隐藏标注':'显示标注';$('#zoom-minus').disabled=zoom===1;$('#zoom-plus').disabled=zoom===4}
$('#zoom-plus').onclick=()=>{zoom=Math.min(4,zoom+.5);updateZoom()};$('#zoom-minus').onclick=()=>{zoom=Math.max(1,zoom-.5);updateZoom()};$('#zoom-close').onclick=()=>$('#zoom-dialog').close();$('#zoom-annotations').onclick=()=>{zoomMarks=!zoomMarks;updateZoom()};window.addEventListener('resize',()=>{if($('#zoom-dialog').open)updateZoom()});
function downloadProgress(value,label='学习进度'){const blob=new Blob([JSON.stringify({...value,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='病理识图_'+label+'_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
function exportProgress(){downloadProgress(state);toast('学习进度已导出。')}
$('#more-open').onclick=()=>{$('#include-extension').checked=state.prefs.includeExtension;syncNav();$('#more-dialog').showModal()};$('#more-close').onclick=()=>$('#more-dialog').close();
document.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{$('#more-dialog').close();if(b.dataset.more==='exam')startSession(pool(),'exam');else navigate(b.dataset.more)});
$('#include-extension').onchange=e=>{state.prefs.includeExtension=e.target.checked;save();toast('已更新范围，将用于下一组练习和速记。')};
$('#export').onclick=exportProgress;$('#import').onclick=()=>{$('#more-dialog').close();$('#import-file').click()};
$('#reset').onclick=async()=>{$('#more-dialog').close();if(await confirmAction(cloud?.getInfo().connected?'清空作答、错题和收藏，并同步到其他设备？建议先导出进度。':'清空当前浏览器的作答、错题和收藏？建议先导出进度。')){state=fresh();activeSession=null;save();await startSession(pool(),'learn',20,true);toast('进度已清空。')}};
$('#import-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>8*1024*1024)throw Error('too large');const raw=JSON.parse(await f.text());if(raw.version!==1||!raw.records)throw Error('invalid');const next=validateState(raw);if(await confirmAction(cloud?.getInfo().connected?'用备份替换当前学习进度，并同步到其他设备？':'用备份替换当前浏览器的学习进度？')){state=next;activeSession=null;save();navigate('practice');toast('学习进度已恢复。')}}catch(err){toast('文件格式不正确，请选择本站导出的进度 JSON。')}e.target.value=''};
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));$('.brand').onclick=e=>{e.preventDefault();navigate('practice')};
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/^(INPUT|SELECT|TEXTAREA|SUMMARY|A)$/.test(e.target.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;if(activeSession&&view==='practice'&&$('#next')){if(['1','2','3','4'].includes(e.key)){e.preventDefault();main.querySelector(`[data-option="${Number(e.key)-1}"]`)?.click()}else if(e.key==='Enter'&&e.target.tagName!=='BUTTON'){e.preventDefault();$('#next').click()}}});
initializeCloud();
})();
