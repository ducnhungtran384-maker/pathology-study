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
try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw?.version===1)state=validateState(raw)}catch(e){}
function validateState(raw){const out=fresh();for(const [id,r] of Object.entries(raw.records||{})){if(BY_ID[id]&&r&&typeof r==='object'){const attempts=Math.min(100000,Math.max(0,Math.floor(Number(r.attempts)||0)));out.records[id]={attempts,correct:Math.min(attempts,Math.max(0,Math.floor(Number(r.correct)||0))),streak:Math.min(attempts,Math.max(0,Math.floor(Number(r.streak)||0))),lastCorrect:r.lastCorrect===true,lastAt:typeof r.lastAt==='string'?r.lastAt:''}}}out.bookmarks=Array.isArray(raw.bookmarks)?[...new Set(raw.bookmarks.filter(id=>BY_ID[id]))]:[];if(['全部','大体','镜下'].includes(raw.prefs?.kind))out.prefs.kind=raw.prefs.kind;out.prefs.includeExtension=raw.prefs?.includeExtension===true;let s=raw.session;if(s&&Array.isArray(s.ids)){const ids=s.ids.filter(id=>BY_ID[id]);s={...s,ids,index:Math.max(0,ids.indexOf(s.ids[s.index]))}}if(s&&Array.isArray(s.ids)&&s.ids.length&&new Set(s.ids).size===s.ids.length&&s.ids.every(id=>BY_ID[id])&&s.options&&typeof s.options==='object'){const valid=s.ids.every(id=>Array.isArray(s.options[id])&&s.options[id].length===4&&new Set(s.options[id]).size===4&&s.options[id].every(t=>BY_ID[id].options.some(o=>o.text===t)));if(valid){out.session={ids:s.ids,options:s.options,answers:{},index:Math.max(0,Math.min(s.ids.length-1,Math.floor(Number(s.index)||0))),mode:s.mode==='exam'?'exam':'learn',done:s.done===true,started:typeof s.started==='string'?s.started:''};for(const id of s.ids){const a=s.answers?.[id];if(a&&(a.choice===null||s.options[id].includes(a.choice)))out.session.answers[id]={choice:a.choice,correct:a.choice===BY_ID[id].name,peek:a.peek===true,recorded:a.recorded===true}}}}if(out.session?.done&&out.session.ids.some(id=>!out.session.answers[id]))out.session=null;if(out.session)out.prefs.kind=sessionKind(out.session);return out}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){$('#storage-note').textContent='浏览器未允许保存；离开前请导出进度。';toast('当前浏览器无法保存进度，请到“更多”导出备份。')}syncNav()}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2800)}
function confirmAction(message){return new Promise(resolve=>{const d=$('#confirm-dialog');$('#confirm-message').textContent=message;const finish=v=>{d.close();d.oncancel=null;resolve(v)};$('#confirm-yes').onclick=()=>finish(true);$('#confirm-cancel').onclick=()=>finish(false);d.oncancel=e=>{e.preventDefault();finish(false)};d.showModal()})}
function syncNav(){
  const wrong=Object.values(state.records).filter(r=>r.attempts&&!r.lastCorrect).length;
  $('#nav-wrong').textContent=wrong||'';
  $('#saved-count').textContent=state.bookmarks.length||'';
  document.querySelectorAll('[data-nav]').forEach(b=>{
    const active=b.dataset.nav===view;
    b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
}
function sessionKind(s){const kinds=new Set(s.ids.map(id=>BY_ID[id].kind));return kinds.size===1?[...kinds][0]:'全部'}
function pool(){return Q.filter(q=>(state.prefs.includeExtension||q.scope!=='extension')&&(state.prefs.kind==='全部'||q.kind===state.prefs.kind))}
function top(title,sub=''){return `<div class="page-top"><h1 tabindex="-1">${title}</h1>${sub?`<p>${sub}</p>`:''}</div>`}
function setImageError(){main.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.alt='图片加载失败，请使用完整文件或单文件离线版';img.style.minHeight='120px'},{once:true}))}
function navigate(v){clearOptionRoute();view=v;atlasPage=0;collectionPage=0;resultPage=0;showMarks=true;syncNav();if(v==='practice'){if(state.session&&!state.session.done){activeSession=state.session;renderQuestion()}else startSession(pool())}else if(v==='atlas')renderAtlas();else renderCollection();window.scrollTo(0,0)}
async function startSession(items,sessionMode='learn',amount=20,skipConfirm=false){if(!items.length){toast('当前范围没有题目。');return false}if(!skipConfirm&&state.session&&!state.session.done&&state.session.mode==='exam'&&Object.keys(state.session.answers).length){if(!await confirmAction('这组自测尚未交卷，切换后本组自测答案不会计入成绩。确认切换？'))return false}clearOptionRoute();let arr=shuffle(items);arr.sort((a,b)=>(state.records[a.id]?.attempts||0)-(state.records[b.id]?.attempts||0));arr=arr.slice(0,amount);activeSession={ids:arr.map(q=>q.id),options:Object.fromEntries(arr.map(q=>[q.id,shuffle(q.options.map(o=>o.text))])),answers:{},index:0,mode:sessionMode,started:new Date().toISOString(),done:false};state.session=activeSession;state.prefs.kind=sessionKind(activeSession);view='practice';showMarks=true;save();renderQuestion();window.scrollTo(0,0);return true}
function record(id,a){if(a.recorded)return;const r=state.records[id]||{attempts:0,correct:0,streak:0};r.attempts++;if(a.correct){r.correct++;r.streak++}else r.streak=0;r.lastCorrect=a.correct;r.lastAt=new Date().toISOString();state.records[id]=r;a.recorded=true}
function answer(choice){
  const s=activeSession;if(!s||s.done)return;
  const id=s.ids[s.index],q=BY_ID[id];if(s.mode==='learn'&&s.answers[id])return;
  const a={choice,correct:choice===q.name,peek:choice===null,recorded:false};
  s.answers[id]=a;if(s.mode==='learn')record(id,a);state.session=s;showMarks=true;save();renderQuestion();

}
function figure(q,visible){const marks=q.annotations?.marks||[],ratio=(q.imageWidth||1)/(q.imageHeight||1);return `<div class="figure" style="--ratio:${ratio}" data-image-id="${esc(q.id)}"><img src="${esc(q.image)}" alt="病理标本图" draggable="false">${visible&&marks.length?`<svg class="annotation-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${marks.map((m,i)=>`<ellipse data-mark-region="${i+1}" cx="${m.x}" cy="${m.y}" rx="${m.rx}" ry="${m.ry}" fill="none" stroke="#183743" stroke-width="5" vector-effect="non-scaling-stroke"/><ellipse data-mark-region="${i+1}" cx="${m.x}" cy="${m.y}" rx="${m.rx}" ry="${m.ry}" fill="none" stroke="${COLORS[i%3]}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join('')}</svg>${marks.map((m,i)=>`<button type="button" class="mark-number" data-mark-number="${i+1}" aria-label="标注 ${i+1}：${esc(m.label)}" aria-pressed="false" style="left:${Math.max(3,Math.min(97,m.x-m.rx*.7))}%;top:${Math.max(4,Math.min(96,m.y-m.ry*.7))}%;--mark:${COLORS[i%3]}">${i+1}</button>`).join('')}`:''}</div>`}
// Shared, paginated reading surface for modal explanations and the atlas.
let modalStudy=null,collectionPage=0,resultPage=0;
const studyTabs=[['points','识别要点'],['marks','图像标注'],['differences','选项鉴别']];
function sizeImage(target){
  const style=getComputedStyle(target);
  target.style.setProperty('--stage-height',Math.max(1,target.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))+'px');
}
const imageSizer=new ResizeObserver(entries=>entries.forEach(({target})=>sizeImage(target)));
const studySizer=new ResizeObserver(entries=>entries.forEach(({target})=>{
  const root=target.closest('.study-shell');
  if(root?.isConnected&&root._study)paginateStudy(root);
}));
function imagePanel(q,revealed){
  const has=q.annotations?.marks?.length||q.annotations?.note,ratio=q.imageWidth/q.imageHeight;
  const annotated=revealed&&showMarks&&has;
  return `<section class="image-panel"><div class="image-top"><span class="pill">${q.kind==='镜下'?'显微玻片':'大体标本'}</span><div class="image-tools">${revealed&&has?`<button class="quiet" id="toggle-marks" aria-pressed="${showMarks}">${showMarks?'隐藏标注':'显示标注'}</button>`:''}<button class="quiet" id="zoom">放大 ↗</button></div></div><div class="image-body ${annotated?'with-notes':''} ${ratio>3?'wide-image':ratio<.4?'tall-image':''}"><div class="image-wrap" id="image-open" role="group" tabindex="0" aria-label="标本图，按回车放大">${figure(q,revealed&&showMarks)}</div>${annotated?'<aside id="image-notes" class="annotation-rail study-shell" aria-label="图片下方标注说明"></aside>':''}</div></section>`;
}
function bindImage(q,revealed,rerender){
  $('#zoom').onclick=()=>openZoom(q,revealed);
  $('#image-open').onclick=e=>{if(!e.target.closest('[data-mark-number]'))openZoom(q,revealed)};
  $('#image-open').onkeydown=e=>{if(e.target===$('#image-open')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();openZoom(q,revealed)}};
  if($('#toggle-marks'))$('#toggle-marks').onclick=()=>{showMarks=!showMarks;rerender()};
  if($('#image-notes'))mountAnnotationNotes($('#image-notes'),q);
  imageSizer.disconnect();sizeImage($('#image-open'));imageSizer.observe($('#image-open'));
}
function optionHref(q,text){return '#option/'+encodeURIComponent(q.id)+'/'+q.options.findIndex(o=>o.text===text)}
function optionTarget(q,text){
  // Similar names or stages are not interchangeable.
  return Q.filter(item=>item.name===text).sort((a,b)=>Number(b.kind===q.kind)-Number(a.kind===q.kind)||Number(a.scope==='extension')-Number(b.scope==='extension'))[0]||null;
}
function optionLink(q,text,cls='option-link'){return `<a class="${cls}" data-option-link href="${optionHref(q,text)}">${esc(text)}<span class="link-arrow" aria-hidden="true"> ↗</span></a>`}
function renderOption(q,text,i,a,revealed){
  let cls='',badge='';
  if(revealed){if(text===q.name){cls='correct';badge='正确答案'}else if(text===a?.choice){cls='wrong';badge='你的选择'}}else if(text===a?.choice)cls='chosen';
  const body=`<span class="option-letter"><span class="choice-letter">${'ABCD'[i]}</span>${badge?`<span class="choice-result" aria-hidden="true">${cls==='correct'?'✓':'✕'}</span>`:''}</span><span class="option-copy">${revealed&&text!==q.name?optionLink(q,text):esc(text)}</span>${badge?`<span class="option-icon">${badge}</span>`:''}`;
  return revealed?`<div class="option answered ${cls}">${body}</div>`:`<button class="option ${cls}" data-option="${i}">${body}</button>`;
}
function corePoint(q){return q.points[0].replace(/^(识别关键词|核心词)[：:]\s*/,'')}
function studyEntries(q,tab){
  if(tab==='marks'){
    const marks=(q.annotations?.marks||[]).map((m,i)=>({kind:'mark',label:m.label,text:m.detail,number:i+1,color:COLORS[i%3]}));
    if(q.annotations?.note)marks.push({kind:'note',label:'注意',text:q.annotations.note});
    return marks.length?marks:[{kind:'note',label:'图像观察',text:'本图暂无定位标注，请结合识别要点观察。'}];
  }
  if(tab==='differences')return q.options.filter(o=>o.text!==q.name).map(o=>({kind:'difference',label:o.text,text:o.reason.replace(/^鉴别要点[：:]\s*/,''),href:optionHref(q,o.text)}));
  const points=q.points.map((text,i)=>({kind:i===0?'key':'point',label:i===0?'核心特征':'观察细节',text:i===0?corePoint(q):text}));
  if(q.caution)points.push({kind:'caution',label:'判断边界',text:q.caution});
  return points;
}
function studyEntry(entry){
  const label=esc(entry.label)+(entry.continued?'（续）':'');
  return `<article class="study-card ${entry.kind}" data-study-entry ${entry.number?`data-mark-entry="${entry.number}"`:''}><h3>${entry.number?`<span class="legend-number" style="--mark:${entry.color}">${entry.number}</span>`:''}${entry.href?`<a data-option-link href="${entry.href}">${label}<span aria-hidden="true"> ↗</span></a>`:label}</h3><p>${esc(entry.text)}</p></article>`;
}
function paginateStudy(root){
  const state=root._study,content=root.querySelector('.study-content');
  if(!state||!root.getClientRects().length||getComputedStyle(content).display==='none')return;
  const inline=root.classList.contains('annotation-rail');
  if(inline)root.style.removeProperty('--notes-height');
  root.classList.add('single-page');
  if(content.clientHeight<1)return;
  const entries=studyEntries(BY_ID[state.qid],state.tab),pages=[];
  let current=[];
  const fits=items=>{content.innerHTML=items.map(studyEntry).join('');return content.scrollHeight<=content.clientHeight+1};
  const allFit=fits(entries);
  if(allFit)pages.push(entries);
  else root.classList.remove('single-page');
  for(const entry of allFit?[]:entries){
    if(fits([...current,entry])){current.push(entry);continue}
    if(current.length){pages.push(current);current=[]}
    let remaining={...entry};
    while(!fits([remaining])){
      const chars=Array.from(remaining.text);let lo=1,hi=chars.length,best=0;
      while(lo<=hi){const mid=Math.floor((lo+hi)/2);if(fits([{...remaining,text:chars.slice(0,mid).join('')}])){best=mid;lo=mid+1}else hi=mid-1}
      if(!best){current=[remaining];break}
      // Prefer a sentence boundary when it does not leave most of the page empty.
      const prefix=chars.slice(0,best).join(''),boundary=Math.max(prefix.lastIndexOf('。'),prefix.lastIndexOf('；'),prefix.lastIndexOf('，'))+1;
      if(boundary>best*.65)best=boundary;
      pages.push([{...remaining,text:chars.slice(0,best).join('')}]);
      remaining={...remaining,text:chars.slice(best).join(''),continued:true};
    }
    if(!current.length)current=[remaining];
  }
  if(current.length)pages.push(current);
  state.pages=pages;state.page=Math.max(0,Math.min(state.page,pages.length-1));
  content.innerHTML=(pages[state.page]||[]).map(studyEntry).join('');
  root.querySelector('[data-study-prev]').disabled=state.page===0;
  root.querySelector('[data-study-next]').disabled=state.page===pages.length-1;
  root.querySelector('[data-study-count]').textContent=`${state.page+1} / ${pages.length}`;
  root.querySelectorAll('[data-annotation-number]').forEach(button=>button.setAttribute('aria-pressed',pages[state.page]?.some(entry=>entry.number===Number(button.dataset.annotationNumber))||false));
  if(inline){
    if(allFit){
      const first=content.firstElementChild,last=content.lastElementChild,s=getComputedStyle(root);
      const textHeight=first&&last?last.getBoundingClientRect().bottom-first.getBoundingClientRect().top:0;
      root.style.setProperty('--notes-height',Math.ceil(textHeight+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth))+'px');
    }
    highlightAnnotation(root,state.selectedNumber);
  }
}
function highlightAnnotation(root,number){
  const surface=root.closest('.image-panel,.zoom-layout');if(!surface)return;
  surface.querySelectorAll('[data-mark-number]').forEach(button=>{const selected=Number(button.dataset.markNumber)===number;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',selected)});
  surface.querySelectorAll('[data-mark-region]').forEach(region=>region.classList.toggle('is-selected',Number(region.dataset.markRegion)===number));
  surface.querySelector('.figure')?.classList.toggle('has-selected',!!number);
  root.querySelectorAll('[data-mark-entry]').forEach(card=>{card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',`定位标注 ${card.dataset.markEntry}`);card.classList.toggle('is-selected',Number(card.dataset.markEntry)===number)});
}
function selectAnnotation(root,number){
  const s=root?._study;if(!s)return;
  const page=s.pages.findIndex(entries=>entries.some(entry=>entry.number===number));
  if(page<0)return;s.selectedNumber=number;s.page=page;paginateStudy(root);
}
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-mark-number]');if(!button)return;
  const root=button.closest('.image-panel,.zoom-layout')?.querySelector('.annotation-rail');
  selectAnnotation(root,Number(button.dataset.markNumber));
});
function mountAnnotationNotes(root,q,page=0){
  root._study={qid:q.id,tab:'marks',page};
  root.innerHTML=`<div class="annotation-rail-head"><span>${q.annotations.marks.length?'图像标注':'观察说明'}</span></div><div class="study-content" aria-live="polite"></div><div class="study-pagination"><button data-study-prev aria-label="上一页标注">←</button><div class="annotation-jumps" aria-label="选择标注">${q.annotations.marks.map((mark,index)=>`<button data-annotation-number="${index+1}" aria-label="标注 ${index+1}：${esc(mark.label)}" aria-pressed="false" style="--mark:${COLORS[index%3]}">${index+1}</button>`).join('')}</div><span data-study-count aria-live="polite"></span><button class="notes-expand" data-notes-expand>完整标注</button><button data-study-next aria-label="下一页标注">→</button></div>`;
  root.querySelector('[data-study-prev]').onclick=()=>{root._study.page--;paginateStudy(root)};
  root.querySelector('[data-study-next]').onclick=()=>{root._study.page++;paginateStudy(root)};
  root.querySelectorAll('[data-annotation-number]').forEach(button=>button.onclick=()=>selectAnnotation(root,Number(button.dataset.annotationNumber)));
  root.querySelector('[data-notes-expand]').onclick=()=>openStudy(q,'marks');
  root.onclick=e=>{const card=e.target.closest('[data-mark-entry]');if(card)selectAnnotation(root,Number(card.dataset.markEntry))};
  root.onkeydown=e=>{if(e.target.matches('[data-mark-entry]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();selectAnnotation(root,Number(e.target.dataset.markEntry))}};
  paginateStudy(root);studySizer.observe(root.querySelector('.study-content'));
}
function mountStudy(root,q,tab='points',page=0){
  root._study={qid:q.id,tab,page};
  const prefix=root.id;
  root.innerHTML=`<div class="study-tabs" role="tablist" aria-label="解析分类">${studyTabs.map(([id,label])=>`<button id="${prefix}-${id}" data-study-tab="${id}" role="tab" aria-controls="${prefix}-content" aria-selected="${id===tab}">${label}</button>`).join('')}</div><div id="${prefix}-content" class="study-content" role="tabpanel" aria-labelledby="${prefix}-${tab}"></div><div class="study-pagination"><button data-study-prev aria-label="上一页解析">← 上一页</button><span data-study-count aria-live="polite"></span><button data-study-next aria-label="下一页解析">下一页 →</button></div>`;
  root.querySelectorAll('[data-study-tab]').forEach(button=>button.onclick=()=>{
    if(root.id==='study-page'&&matchMedia('(max-width:760px) and (max-height:680px) and (orientation:portrait)').matches){openStudy(q,button.dataset.studyTab);return}
    root._study.tab=button.dataset.studyTab;root._study.page=0;
    root.querySelectorAll('[data-study-tab]').forEach(b=>b.setAttribute('aria-selected',b===button));
    root.querySelector('.study-content').setAttribute('aria-labelledby',button.id);paginateStudy(root);
  });
  root.onkeydown=e=>{
    if(!e.target.matches('[data-study-tab]')||!['ArrowLeft','ArrowRight'].includes(e.key))return;
    const buttons=[...root.querySelectorAll('[data-study-tab]')],index=buttons.indexOf(e.target),next=(index+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length;
    e.preventDefault();buttons[next].focus();buttons[next].click();
  };
  root.querySelector('[data-study-prev]').onclick=()=>{root._study.page--;paginateStudy(root)};
  root.querySelector('[data-study-next]').onclick=()=>{root._study.page++;paginateStudy(root)};
  paginateStudy(root);studySizer.observe(root.querySelector('.study-content'));
}
function openStudy(q,tab='points',page=0){
  modalStudy={qid:q.id,tab,page};
  $('#study-title').textContent=q.name;
  if(!$('#study-dialog').open)$('#study-dialog').showModal();
  mountStudy($('#study-modal'),q,tab,page);
}
function closeStudy(){if($('#study-dialog').open)$('#study-dialog').close();modalStudy=null}
$('#study-close').onclick=closeStudy;
$('#study-dialog').addEventListener('close',()=>{modalStudy=null});
function studySnapshot(){const s=$('#study-modal')._study;return $('#study-dialog').open&&s?{qid:s.qid,tab:s.tab,page:s.page}:null}

function clearOptionRoute(){
  closeStudy();reviewOrigin=null;atlasDetailId=null;
  if(location.hash.startsWith('#option/'))history.replaceState(null,'',location.pathname+location.search);
}
let refreshScreen=null;
function prepareScreen(name,refresh){
  main.dataset.screen=name;refreshScreen=refresh;
  studySizer.disconnect();
  if($('#study-dialog').open)studySizer.observe($('#study-modal .study-content'));
}
function captureReviewOrigin(){
  const detail=main.querySelector('#study-page')?._study;
  return {view,atlasDetailId,atlasPage,atlasKind,search,showMarks,questionId:view==='practice'?activeSession?.ids[activeSession.index]:null,sessionStarted:activeSession?.started,focusHref:document.activeElement?.getAttribute('href')||'',modal:studySnapshot(),detail:detail?{tab:detail.tab,page:detail.page}:null};
}
function restoreReviewOrigin(){
  const origin=reviewOrigin||history.state?.pathologyOrigin||{view:'practice'};
  reviewOrigin=null;showMarks=origin.showMarks!==false;
  atlasPage=origin.atlasPage||0;atlasKind=origin.atlasKind||'全部';search=origin.search||'';
  if(origin.view==='atlas'){
    view='atlas';syncNav();
    if(BY_ID[origin.atlasDetailId])renderAtlasDetail(BY_ID[origin.atlasDetailId],origin.detail);else renderAtlas();
  }else if(state.session&&(!origin.questionId||state.session.started===origin.sessionStarted&&state.session.ids.includes(origin.questionId))){
    activeSession=state.session;
    if(origin.questionId){const index=activeSession.ids.indexOf(origin.questionId);if(activeSession.index!==index){activeSession.index=index;save()}}
    renderQuestion();
  }else if(BY_ID[origin.questionId]){view='atlas';syncNav();renderAtlasDetail(BY_ID[origin.questionId])}
  else navigate('practice');
  if(origin.modal&&BY_ID[origin.modal.qid])openStudy(BY_ID[origin.modal.qid],origin.modal.tab,origin.modal.page);
  const focusRoot=$('#study-dialog').open?$('#study-dialog'):main;
  [...focusRoot.querySelectorAll('[data-option-link]')].find(a=>a.getAttribute('href')===origin.focusHref)?.focus({preventScroll:true});
}
function renderOptionRoute(){
  const match=location.hash.match(/^#option\/([^/]+)\/(\d+)$/);
  if(!match)return false;
  const q=BY_ID[match[1]],o=q?.options[Number(match[2])];
  if(!q||!o){history.replaceState(null,'',location.pathname+location.search);restoreReviewOrigin();toast('这条链接已失效，已返回复习页面。');return true}
  closeStudy();
  reviewOrigin=reviewOrigin||history.state?.pathologyOrigin||{view:'atlas',atlasDetailId:q.id,fromSharedLink:true};
  history.replaceState({pathologyOrigin:reviewOrigin},'');
  view='review';syncNav();
  const target=optionTarget(q,o.text),back=reviewOrigin.fromSharedLink?'查看原题':reviewOrigin.view==='atlas'?'返回速记':'返回原题';
  const old=main.querySelector('#study-page')?._study,reader=old?.qid===target?.id?old:null;
  prepareScreen(target?'detail':'note',renderOptionRoute);
  main.innerHTML=`<div class="detail-heading"><a class="review-back" href="#" data-review-back>← ${back}</a><h1 tabindex="-1">${esc(o.text)}</h1>${target?`<button id="detail-save" class="quiet">${state.bookmarks.includes(target.id)?'★ 已收藏':'☆ 收藏'}</button>`:''}</div>`+(target?`<div class="quiz-grid detail-grid">${imagePanel(target,true)}<section id="study-page" class="study-shell study-panel" aria-label="${esc(target.name)}的解析"></section></div>`:`<section class="panel option-note"><h2>与${esc(q.name)}的区别</h2><p>${esc(o.reason.replace(/^鉴别要点[：:]\s*/,''))}</p><p class="muted">暂无独立题图</p></section>`);
  if(target){$('#detail-save').onclick=()=>{toggleBookmark(target.id);renderOptionRoute()};bindImage(target,true,renderOptionRoute);mountStudy($('#study-page'),target,reader?.tab||'points',reader?.page||0)}
  setImageError();return true;
}
document.addEventListener('click',e=>{
  if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
  if(e.target.closest('[data-review-back]')){
    e.preventDefault();history.pushState(null,'',location.pathname+location.search);restoreReviewOrigin();return;
  }
  const link=e.target.closest('a[data-option-link]');
  if(!link)return;
  if(view!=='review'){reviewOrigin=captureReviewOrigin();reviewOrigin.focusHref=link.getAttribute('href');history.replaceState({pathologyOrigin:reviewOrigin},'')}
  closeStudy();showMarks=true;
});
window.addEventListener('hashchange',()=>{
  if(location.hash.startsWith('#option/')){renderOptionRoute();main.querySelector('h1')?.focus({preventScroll:true})}
  else if(view==='review')restoreReviewOrigin();
});
function renderQuestion(){
  const s=activeSession;if(!s)return;
  view='practice';syncNav();prepareScreen('practice',renderQuestion);
  const id=s.ids[s.index],q=BY_ID[id],a=s.answers[id],revealed=(s.mode==='learn'&&!!a)||s.done;
  const included=Q.filter(x=>state.prefs.includeExtension||x.scope!=='extension'),seen=included.filter(x=>state.records[x.id]?.attempts).length;
  const answeredLabel=a?.peek?'已查看答案':a?.correct?'回答正确':'再辨认一次';
  main.innerHTML=`<div class="practice-bar"><h1>${s.done?'本组复盘':s.mode==='exam'?'自测':'识图练习'}</h1><div class="kind-tabs" aria-label="题库类型">${['全部','大体','镜下'].map(k=>`<button data-kind="${k}" aria-pressed="${state.prefs.kind===k}" class="${state.prefs.kind===k?'active':''}">${k==='全部'?'混合':k}</button>`).join('')}</div><span class="session-count"><b>${String(s.index+1).padStart(2,'0')}</b> / ${s.ids.length}</span><button id="bookmark" class="quiet" aria-label="${state.bookmarks.includes(id)?'取消收藏':'收藏本题'}" aria-pressed="${state.bookmarks.includes(id)}">${state.bookmarks.includes(id)?'★':'☆'}</button></div>
  <div class="quiz-grid"><section class="image-column">${imagePanel(q,revealed)}</section><section class="question-panel"><h2 class="${revealed?(a?.correct?'feedback-correct':'feedback-incorrect'):''}" role="status">${revealed?`${a?.correct?'✓ ':''}${answeredLabel}`:esc(q.prompt||'图中最符合下列哪一项？')}</h2>${revealed?`<button class="answer-key" id="key-open" aria-label="查看完整识别要点">${esc(corePoint(q))}<span aria-hidden="true">↗</span></button>`:''}<div class="options">${s.options[id].map((text,i)=>renderOption(q,text,i,a,revealed)).join('')}</div><div class="question-actions"><button id="prev" ${s.index===0?'disabled':''}>上一题</button>${revealed?'<button id="analysis-open">解析</button><button id="differences-open">鉴别</button>':s.mode==='learn'?'<button id="peek" class="quiet">不会</button>':''}<button id="next" class="primary">${s.index===s.ids.length-1?(s.done?'成绩':s.mode==='exam'?'交卷':'完成本组'):'下一题'}</button></div></section></div>
  <div class="bottom-progress"><span class="coverage-progress"><progress value="${seen}" max="${included.length}" aria-label="题库练习进度"></progress>已练 ${seen} / ${included.length} 题</span><div>${s.mode==='exam'&&!s.done?'<button id="submit" class="quiet">提前交卷</button>':''}${s.done?'<button id="result" class="quiet">本组成绩</button>':''}</div></div>`;
  main.querySelectorAll('[data-kind]').forEach(b=>b.onclick=async()=>{const old=state.prefs.kind;state.prefs.kind=b.dataset.kind;if(!await startSession(pool()))state.prefs.kind=old});
  main.querySelectorAll('[data-option]').forEach(b=>b.onclick=()=>answer(s.options[id][Number(b.dataset.option)]));
  $('#bookmark').onclick=()=>{toggleBookmark(id);renderQuestion()};bindImage(q,revealed,renderQuestion);
  $('#prev').onclick=()=>jump(s.index-1);
  $('#next').onclick=()=>{if(s.index<s.ids.length-1)jump(s.index+1);else s.done?renderResults():finishSession()};
  if($('#peek'))$('#peek').onclick=()=>{answer(null);openStudy(q)};
  if($('#analysis-open'))$('#analysis-open').onclick=()=>openStudy(q);
  if($('#key-open'))$('#key-open').onclick=()=>openStudy(q);
  if($('#differences-open'))$('#differences-open').onclick=()=>openStudy(q,'differences');
  if($('#submit'))$('#submit').onclick=finishSession;
  if($('#result'))$('#result').onclick=renderResults;
  setImageError();
}
function toggleBookmark(id){state.bookmarks.includes(id)?state.bookmarks=state.bookmarks.filter(x=>x!==id):state.bookmarks.push(id);save()}
function jump(i){if(!activeSession||i<0||i>=activeSession.ids.length)return;closeStudy();activeSession.index=i;showMarks=true;save();renderQuestion()}
async function finishSession(){
  const s=activeSession;if(!s||s.done)return;
  const missing=s.ids.filter(id=>!s.answers[id]);
  if(missing.length&&!await confirmAction(`还有 ${missing.length} 题未答。结束后按未答计入错题，仍可查看解析。确认结束本组？`))return;
  for(const id of s.ids){if(!s.answers[id])s.answers[id]={choice:null,correct:false,peek:false,recorded:false};record(id,s.answers[id])}
  s.done=true;state.session=s;resultPage=0;save();renderResults();
}
function listPager(page,pages,total){return `<div class="pagination"><button id="list-prev" ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${pages} · ${total} 题</span><button id="list-next" ${page===pages-1?'disabled':''}>下一页</button></div>`}
function listCapacity(results=false){
  const reserved=results?250:160;
  return Math.max(1,Math.floor((main.clientHeight-reserved)/(innerWidth<450?104:90)));
}
function renderResults(){
  const s=activeSession;if(!s)return;
  view='practice';syncNav();prepareScreen('results',renderResults);
  const wrong=s.ids.filter(id=>!s.answers[id]?.correct),correct=s.ids.length-wrong.length,per=listCapacity(true),pages=Math.ceil(s.ids.length/per);
  resultPage=Math.min(resultPage,pages-1);
  main.innerHTML=`<div class="list-heading"><h1>本组完成</h1><span class="result-score">${correct}<small> / ${s.ids.length} 题答对</small></span></div><section class="result-summary"><p>${wrong.length?`${wrong.length} 题已加入错题本`:'本组全部答对'}</p><div class="result-actions">${wrong.length?'<button class="primary" id="retry">只练本组错题</button>':''}<button id="next-group">再练 20 题</button></div></section><section class="collection-list" aria-label="逐题回看">${s.ids.slice(resultPage*per,(resultPage+1)*per).map((id,index)=>{const q=BY_ID[id],a=s.answers[id];return `<div class="collection-item"><img src="${esc(q.image)}" alt="${esc(q.name)}"><div class="collection-info"><b>${a.correct?'✓':'✕'} ${esc(q.name)}</b><small>${esc(q.kind)} · ${a.choice?'作答：'+esc(a.choice):a.peek?'查看了答案':'未作答'}</small></div><button data-review="${resultPage*per+index}">解析</button></div>`}).join('')}</section>${listPager(resultPage,pages,s.ids.length)}`;
  if($('#retry'))$('#retry').onclick=()=>startSession(wrong.map(id=>BY_ID[id]),'learn',wrong.length);
  $('#next-group').onclick=()=>startSession(pool());
  main.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>jump(Number(b.dataset.review)));
  $('#list-prev').onclick=()=>{resultPage--;renderResults()};$('#list-next').onclick=()=>{resultPage++;renderResults()};setImageError();
}
function renderCollection(){
  const wrong=view==='wrong',items=Q.filter(q=>wrong?state.records[q.id]?.attempts&&!state.records[q.id]?.lastCorrect:state.bookmarks.includes(q.id));
  syncNav();prepareScreen('collection',renderCollection);
  const per=listCapacity(),pages=Math.max(1,Math.ceil(items.length/per));collectionPage=Math.min(collectionPage,pages-1);
  main.innerHTML=`<div class="list-heading"><h1>${wrong?'错题本':'我的收藏'} <small>${items.length}</small></h1>${items.length?'<button class="primary" id="practice-collection">开始重练</button>':''}</div>`+(items.length?`<section class="collection-list" aria-label="${wrong?'错题':'收藏'}列表">${items.slice(collectionPage*per,(collectionPage+1)*per).map(q=>`<div class="collection-item"><img src="${esc(q.image)}" alt="${esc(q.name)}"><div class="collection-info"><b>${esc(q.name)}</b><small>${esc(q.kind)} · ${esc(q.system)}</small></div><div class="collection-actions"><button data-single="${q.id}">练这题</button>${!wrong?`<button class="quiet" data-remove="${q.id}" aria-label="取消收藏${esc(q.name)}">取消</button>`:''}</div></div>`).join('')}</section>${listPager(collectionPage,pages,items.length)}`:`<div class="empty"><h2>${wrong?'当前没有错题':'还没有收藏'}</h2><p>${wrong?'不会或答错的题，会自动收集到这里。':'点击题目上方的 ☆ 收藏。'}</p><button class="primary" id="back-practice">继续刷题</button></div>`);
  if($('#practice-collection'))$('#practice-collection').onclick=()=>startSession(items,'learn',items.length);
  if($('#back-practice'))$('#back-practice').onclick=()=>navigate('practice');
  main.querySelectorAll('[data-single]').forEach(b=>b.onclick=()=>startSession([BY_ID[b.dataset.single]],'learn',1));
  main.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{toggleBookmark(b.dataset.remove);renderCollection()});
  if($('#list-prev')){$('#list-prev').onclick=()=>{collectionPage--;renderCollection()};$('#list-next').onclick=()=>{collectionPage++;renderCollection()}}
  setImageError();
}
function renderAtlas(){
  atlasDetailId=null;view='atlas';syncNav();prepareScreen('atlas',renderAtlas);
  const items=Q.filter(q=>(state.prefs.includeExtension||q.scope!=='extension')&&(atlasKind==='全部'||q.kind===atlasKind)&&(!search||[q.name,q.system,...q.points].join(' ').includes(search)));
  const columns=main.clientWidth<660?2:3,rows=Math.max(1,Math.min(3,Math.floor((main.clientHeight-180)/230))),per=columns*rows,pages=Math.max(1,Math.ceil(items.length/per));
  atlasPage=Math.min(atlasPage,pages-1);
  main.innerHTML=`<div class="list-heading"><h1>识别速记</h1></div><div class="search-bar"><input id="atlas-search" type="search" value="${esc(search)}" placeholder="搜索病名或特征" aria-label="搜索病名或特征"><select id="atlas-kind" aria-label="图片类型">${['全部','大体','镜下'].map(k=>`<option ${k===atlasKind?'selected':''}>${k}</option>`).join('')}</select></div>`+(items.length?`<div class="atlas-grid" style="--atlas-columns:${columns};--atlas-rows:${rows}">${items.slice(atlasPage*per,(atlasPage+1)*per).map(q=>`<article class="atlas-card"><button data-detail="${q.id}" aria-label="查看${esc(q.name)}的标注"><img src="${esc(q.image)}" alt="${esc(q.name)}"><div class="atlas-body"><h3>${esc(q.name)}</h3><p>${esc(q.kind)}</p></div></button></article>`).join('')}</div>`:'<div class="empty">没有匹配结果，试试更短的关键词。</div>')+`<div class="pagination"><button id="atlas-prev" ${atlasPage===0?'disabled':''}>上一页</button><span>${atlasPage+1} / ${pages} · ${items.length} 题</span><button id="atlas-next" ${atlasPage===pages-1?'disabled':''}>下一页</button></div>`;
  $('#atlas-search').oninput=e=>{search=e.target.value;atlasPage=0;const p=e.target.selectionStart;renderAtlas();$('#atlas-search').focus({preventScroll:true});$('#atlas-search').setSelectionRange(p,p)};
  $('#atlas-kind').onchange=e=>{atlasKind=e.target.value;atlasPage=0;renderAtlas()};
  $('#atlas-prev').onclick=()=>{atlasPage--;renderAtlas()};$('#atlas-next').onclick=()=>{atlasPage++;renderAtlas()};
  main.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{showMarks=true;renderAtlasDetail(BY_ID[b.dataset.detail])});setImageError();
}
function renderAtlasDetail(q,detailSnapshot=null){
  atlasDetailId=q.id;view='atlas';syncNav();
  const old=main.querySelector('#study-page')?._study,reader=detailSnapshot||(old?.qid===q.id?old:null);
  const refresh=()=>renderAtlasDetail(q);prepareScreen('detail',refresh);
  main.innerHTML=`<div class="detail-heading"><button id="atlas-back" class="quiet">← 返回速记</button><h1>${esc(q.name)}</h1><button id="detail-save" class="quiet">${state.bookmarks.includes(q.id)?'★ 已收藏':'☆ 收藏'}</button></div><div class="quiz-grid detail-grid">${imagePanel(q,true)}<section id="study-page" class="study-shell study-panel" aria-label="${esc(q.name)}的解析"></section></div>`;
  $('#atlas-back').onclick=renderAtlas;$('#detail-save').onclick=()=>{toggleBookmark(q.id);refresh()};bindImage(q,true,refresh);mountStudy($('#study-page'),q,reader?.tab||'points',reader?.page||0);setImageError();
}
let resizeTimer;
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{
    // Images and readers size themselves; only paged lists need a new item count.
    if(!['atlas','collection','results'].includes(main.dataset.screen))return;
    const searchFocused=document.activeElement?.id==='atlas-search',caret=searchFocused?document.activeElement.selectionStart:null;
    refreshScreen?.();
    if(searchFocused&&$('#atlas-search')){$('#atlas-search').focus({preventScroll:true});$('#atlas-search').setSelectionRange(caret,caret)}
  },100);
});


let zoom=1,zoomQuestion=null,zoomAllowed=false,zoomMarks=false;
function openZoom(q,allowed){zoom=1;zoomQuestion=q;zoomAllowed=allowed;zoomMarks=allowed&&showMarks;$('#zoom-title').textContent='查看标本';$('#zoom-dialog').showModal();updateZoom()}
function updateZoom(){
  if(!zoomQuestion)return;
  const q=zoomQuestion,notes=$('#zoom-notes'),annotated=zoomAllowed&&zoomMarks&&(q.annotations?.marks?.length||q.annotations?.note);
  const old=notes._study,page=old?.qid===q.id?old.page:0;
  notes.hidden=!annotated;$('.zoom-layout').classList.toggle('with-notes',!!annotated);
  $('#zoom-level').textContent=Math.round(zoom*100)+'%';$('#zoom-canvas').innerHTML=figure(q,zoomAllowed&&zoomMarks);
  if(annotated){const previous=notes.querySelector('.study-content');if(previous)studySizer.unobserve(previous);mountAnnotationNotes(notes,q,page)}
  else {notes.innerHTML='';notes._study=null}
  const stage=$('.zoom-stage'),ratio=(q.imageWidth||1)/(q.imageHeight||1),base=Math.min(stage.clientWidth-32,(stage.clientHeight-32)*ratio);
  $('#zoom-canvas').style.width=Math.max(1,base*zoom)+'px';
  $('#zoom-annotations').hidden=!(zoomAllowed&&(q.annotations?.marks?.length||q.annotations?.note));$('#zoom-annotations').textContent=zoomMarks?'隐藏标注':'显示标注';$('#zoom-minus').disabled=zoom===1;$('#zoom-plus').disabled=zoom===4;
}
$('#zoom-plus').onclick=()=>{zoom=Math.min(4,zoom+.5);updateZoom()};$('#zoom-minus').onclick=()=>{zoom=Math.max(1,zoom-.5);updateZoom()};$('#zoom-close').onclick=()=>$('#zoom-dialog').close();$('#zoom-annotations').onclick=()=>{zoomMarks=!zoomMarks;updateZoom()};window.addEventListener('resize',()=>{if($('#zoom-dialog').open)updateZoom()});
function downloadProgress(value,label='学习进度'){const blob=new Blob([JSON.stringify({...value,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='病理识图_'+label+'_'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
function exportProgress(){downloadProgress(state);toast('学习进度已导出。')}
$('#more-open').onclick=()=>{$('#include-extension').checked=state.prefs.includeExtension;syncNav();$('#more-dialog').showModal()};$('#more-close').onclick=()=>$('#more-dialog').close();
document.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{$('#more-dialog').close();if(b.dataset.more==='exam')startSession(pool(),'exam');else navigate(b.dataset.more)});
$('#include-extension').onchange=e=>{state.prefs.includeExtension=e.target.checked;save();toast('已更新范围，将用于下一组练习和速记。')};
$('#export').onclick=exportProgress;$('#import').onclick=()=>{$('#more-dialog').close();$('#import-file').click()};
$('#reset').onclick=async()=>{$('#more-dialog').close();if(await confirmAction('清空当前浏览器的作答、错题和收藏？建议先导出进度。')){state=fresh();activeSession=null;save();await startSession(pool(),'learn',20,true);toast('进度已清空。')}};
$('#import-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>8*1024*1024)throw Error('too large');const raw=JSON.parse(await f.text());if(raw.version!==1||!raw.records)throw Error('invalid');const next=validateState(raw);if(await confirmAction('用备份替换当前浏览器的学习进度？')){state=next;activeSession=null;save();navigate('practice');toast('学习进度已恢复。')}}catch(err){toast('文件格式不正确，请选择本站导出的进度 JSON。')}e.target.value=''};
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>navigate(b.dataset.nav));$('.brand').onclick=e=>{e.preventDefault();navigate('practice')};
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/^(INPUT|SELECT|TEXTAREA|SUMMARY|A)$/.test(e.target.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;if(activeSession&&view==='practice'&&$('#next')){if(['1','2','3','4'].includes(e.key)){e.preventDefault();main.querySelector(`[data-option="${Number(e.key)-1}"]`)?.click()}else if(e.key==='Enter'&&e.target.tagName!=='BUTTON'){e.preventDefault();$('#next').click()}}});
if(!renderOptionRoute()){if(state.session){activeSession=state.session;renderQuestion()}else navigate('practice')}
})();
