'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
const colors = ['#22d3ee','#a78bfa','#34d399','#fbbf24','#f472b6','#60a5fa'];
const demo = document.documentElement.dataset.demo === 'true';
let state, view='all', previewId=null, dragged=null, notesDirty=false, queue=Promise.resolve(), toastTimer, updateTimer;
let demoState, bulkRows=[];
const layouts=['compact','cards','table','tv'];
const starterApps = [
 ['Plex',32400,'/web','▶','Your movies, TV and music.'],['Sonarr',8989,'','S','Your TV library and series.'],
 ['Radarr',7878,'','R','Your movie collection.'],['Prowlarr',9696,'','P','Your indexers in one place.'],
 ['Bazarr',6767,'','B','Subtitles, sorted.'],['qBittorrent',8080,'','qB','Your downloads.'],
 ['Seerr',5055,'','SE','Discover and request media.'],['HomeLabStats',8090,'','>_','Your server, at a glance.'],
 ['ROMM',54001,'','RM','Your retro game library.'],['Portainer',9443,'','PT','Docker management.']
];

async function api(path, method='GET', body) {
 if (demo) return demoApi(path,method,body);
 const options = {method, headers:{'Content-Type':'application/json'}};
 if(body!==undefined) options.body=JSON.stringify(body);
 const r=await fetch('api/'+path,options);
 let data;
 try {data=await r.json();} catch {throw new Error('The server returned an unexpected response.');}
 if(!r.ok) throw new Error(data.error || 'Request failed. Please try again.');
 return data;
}
function validUrl(value, optional=false) {
 if(optional && !value) return '';
 const u=new URL(value);
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||/[\x00-\x20]/.test(value)) throw new Error('Use a complete http:// or https:// URL without credentials.');
 return value;
}
async function demoApi(path,method,body) {
 if(!demoState) {
  let saved; try {saved=JSON.parse(localStorage.getItem('bhxuk-dash-demo-v1'));} catch {}
  demoState=saved?.schema===1?saved:await (await fetch('seed.json')).json();
 }
 const persist=()=>{localStorage.setItem('bhxuk-dash-demo-v1',JSON.stringify(demoState));};
 if(path==='health')return {version:'1.1.0',status:'ok'};
 if(path==='state' && method==='GET')return structuredClone(demoState);
 if(path==='state' && method==='PUT') {
  if(body.revision!==demoState.revision)throw new Error('This demo changed in another tab. Reload to continue.');
  if(body.schema!==1||!Array.isArray(body.links)||!Array.isArray(body.categories)||!body.categories.length||!body.settings||!Array.isArray(body.tasks)||typeof body.notes!=='string') throw new Error('Choose a valid Dash backup.');
  body.links.forEach(l=>{validUrl(l.url);validUrl(l.image,true);if(!colors.includes(l.color))throw new Error('Invalid link colour.');});
  if(!colors.includes(body.settings.accent))throw new Error('Invalid accent colour.');
  new Intl.DateTimeFormat('en-GB',{timeZone:body.settings.timezone});
  demoState=structuredClone(body);demoState.revision++;persist();return structuredClone(demoState);
 }
 if(path==='visit') {
  const l=demoState.links.find(x=>x.id===body.id); if(l){l.visits++;l.lastVisited=Date.now();persist();return {visits:l.visits,lastVisited:l.lastVisited};}
 }
 if(path==='backup')return {filename:'Demo changes are stored in this browser. Use Export backup to download them.'};
 if(path==='changelog')return {text:await(await fetch('CHANGELOG.md')).text()};
 if(path.startsWith('updates'))return {current:'1.1.0',latest:'1.1.0',available:false,canUpdate:false,reason:'The demo runs in your browser. Install Docker on your server to use updates.',state:'idle',log:[]};
 throw new Error('Unavailable in demo.');
}
function toast(message) {
 $('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000);
}
function error(message) {
 toast(message);$('errorBanner').textContent=message;$('errorBanner').hidden=false;
}
function save(mutator,message) {
 const work=queue.then(async()=>{
  const next=structuredClone(state);mutator(next);
  state=await api('state','PUT',next);
  $('errorBanner').hidden=true;render();if(message)toast(message);
 });
 queue=work.catch(e=>error(e.message));
 return work;
}
function openDialog(id) {const d=$(id);if(!d.open)d.showModal();}
function closeDialog(d) {if(d.id==='embedDialog')$('embedFrame').removeAttribute('src');d.close();}
function hostname(url) {try{return new URL(url).host;}catch{return url;}}
function applyAppearance() {
 const s=state.settings;
 document.body.dataset.theme=s.theme;document.body.dataset.background=s.background;
 document.documentElement.style.setProperty('--accent',colors.includes(s.accent)?s.accent:colors[0]);
 const layout=layouts.includes(s.layout)?s.layout:'compact';
 document.body.dataset.layout=layout;document.body.classList.toggle('compact',layout==='compact');
 $('layoutSelect').value=layout;
 $('dashboardName').textContent=s.name==='My dashboard'?'Your favourite places, all in one space.':s.name;
 document.title='Dash · '+s.name;
}
function clock() {
 if(!state)return;
 const zone=state.settings.timezone;
 const now=new Date();
 const format=(tz,seconds=false)=>new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})}).format(now);
 $('clock').textContent=format(zone,state.settings.seconds);$('clock').classList.toggle('with-seconds',state.settings.seconds);
 $('date').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now);
 $('clockZone').textContent=zone.replaceAll('_',' ').replace('/',' / ').toUpperCase();
 $('clockNY').textContent=format('America/New_York');$('clockUTC').textContent=format('UTC');$('clockTokyo').textContent=format('Asia/Tokyo');
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(now));
 $('greeting').innerHTML=(hour<5?'Welcome home':hour<12?'Good morning':hour<18?'Good afternoon':'Welcome home')+'<span>.</span>';
}
function renderNav() {
 const counts={all:state.links.length,pinned:state.links.filter(l=>l.pinned).length,frequent:state.links.filter(l=>l.visits>0).length,recent:state.links.filter(l=>l.lastVisited>0).length};
 $('mainNav').innerHTML=[['all','▦','All links'],['pinned','☆','Favourites'],['frequent','↗','Frequently used'],['recent','◷','Recently opened']].map(([id,icon,name])=>`<button class="navitem ${view===id?'active':''}" data-view="${id}" aria-current="${view===id?'page':'false'}">${icon}<span>${name}</span><span class="nav-count">${counts[id]}</span></button>`).join('');
 $('categoryNav').innerHTML=state.categories.map(c=>`<button class="navitem ${view===c.id?'active':''}" data-view="${esc(c.id)}" aria-current="${view===c.id?'page':'false'}">${esc(c.icon)}<span>${esc(c.name)}</span><span class="nav-count">${state.links.filter(l=>l.category===c.id).length}</span></button>`).join('');
 $('linkCount').textContent=state.links.length;$('categoryCount').textContent=state.categories.length;
}
function visibleLinks() {
 let links=state.links.filter(l=> view==='all'||(view==='pinned'?l.pinned:view==='frequent'?l.visits>0:view==='recent'?l.lastVisited>0:l.category===view));
 const q=$('search').value.trim().toLowerCase();
 if(q) links=links.filter(l=>[l.name,l.url,l.description,state.categories.find(c=>c.id===l.category)?.name].some(v=>v?.toLowerCase().includes(q)));
 const mode=$('sort').value;
 if(mode==='name')links.sort((a,b)=>a.name.localeCompare(b.name));
 else if(mode==='visits'||(mode==='manual'&&view==='frequent'))links.sort((a,b)=>b.visits-a.visits);
 else if(mode==='recent'||(mode==='manual'&&view==='recent'))links.sort((a,b)=>b.lastVisited-a.lastVisited);
 return links;
}
function cardMarkup(l) {return `<article class="link-card" draggable="true" data-id="${esc(l.id)}" style="--card-accent:${colors.includes(l.color)?l.color:colors[0]}">${document.body.dataset.layout==='tv'&&l.image?`<img class="tv-art" src="${esc(l.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<div class="card-top"><span class="app-icon">${esc(l.icon||l.name.slice(0,2).toUpperCase())}</span><button class="pin ${l.pinned?'on':''}" data-action="pin" aria-label="${l.pinned?'Unpin':'Pin'} ${esc(l.name)}" title="${l.pinned?'Unpin':'Pin to favourites'}">${l.pinned?'★':'☆'}</button></div><a class="link-main" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-action="open"><h3>${esc(l.name)}<span>↗</span></h3><p>${esc(l.description||hostname(l.url))}</p></a><div class="card-bottom"><button class="drag-handle" data-action="edit" aria-label="Edit ${esc(l.name)}" title="Drag card to reorder · click to edit">⠿</button><small>${esc(hostname(l.url))}</small><button class="move" data-action="up" aria-label="Move ${esc(l.name)} earlier" title="Move earlier">↑</button><button class="move" data-action="down" aria-label="Move ${esc(l.name)} later" title="Move later">↓</button><button data-action="preview" aria-label="Preview ${esc(l.name)}" title="Preview link">◉</button><button data-action="edit" aria-label="Edit ${esc(l.name)}" title="Edit link">⋯</button></div></article>`;}
function tableMarkup(links) {
 return `<div class="link-table-wrap"><table class="link-table"><thead><tr><th>Name</th><th>URL</th><th>Category</th><th>Opened</th><th>Actions</th></tr></thead><tbody>${links.map(l=>`<tr data-id="${esc(l.id)}" draggable="true" style="--card-accent:${colors.includes(l.color)?l.color:colors[0]}"><td><div class="table-name"><span class="app-icon">${esc(l.icon||l.name.slice(0,2).toUpperCase())}</span><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-action="open">${esc(l.name)}</a><button class="pin ${l.pinned?'on':''}" data-action="pin" aria-label="${l.pinned?'Unpin':'Pin'} ${esc(l.name)}">${l.pinned?'★':'☆'}</button></div></td><td><a class="table-url" href="${esc(l.url)}" title="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-action="open">${esc(l.url)}</a></td><td><span class="table-category">${esc(state.categories.find(c=>c.id===l.category)?.name)}</span></td><td class="table-number">${l.visits}</td><td><div class="table-actions"><button class="iconbtn" data-action="preview" aria-label="Preview ${esc(l.name)}" title="Preview">◉</button><button class="iconbtn" data-action="edit" aria-label="Edit ${esc(l.name)}" title="Edit">⋯</button><button class="iconbtn" data-action="up" aria-label="Move ${esc(l.name)} earlier" title="Move earlier">↑</button><button class="iconbtn" data-action="down" aria-label="Move ${esc(l.name)} later" title="Move later">↓</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
function renderLinks() {
 const links=visibleLinks();
 const titles={all:'All links',pinned:'Favourites',frequent:'Frequently used',recent:'Recently opened'};
 $('viewTitle').innerHTML=esc(titles[view]||state.categories.find(c=>c.id===view)?.name||'All links')+` <span class="count">${links.length}</span>`;
 $('viewEyebrow').textContent=$('search').value?'A LITTLE LESS SEARCHING':'YOUR SPACE, CONNECTED';
 const layout=document.body.dataset.layout;
 $('linkGrid').innerHTML=layout==='table'?tableMarkup(links):layout==='tv'?state.categories.map(c=>{
  const group=links.filter(l=>l.category===c.id);return group.length?`<section class="tv-shelf"><div class="tv-shelf-heading"><h3>${esc(c.name)}</h3><span>${group.length} shortcuts</span></div><div class="tv-tiles">${group.map(cardMarkup).join('')}</div></section>`:'';
 }).join(''):links.map(cardMarkup).join('');
 $('empty').hidden=!!links.length;
 $('emptyText').textContent=$('search').value?'No matches. Try a different search.':view==='frequent'||view==='recent'?'Open a saved link and it will appear here.':'Add a link to make this space yours.';
 $('emptyAdd').hidden=!!$('search').value||view==='recent'||view==='frequent';
}
function renderTasks() {
 $('taskCount').textContent=state.tasks.filter(t=>!t.done).length;
 $('tasks').innerHTML=state.tasks.length?state.tasks.map(t=>`<div class="task ${t.done?'done':''}" data-id="${esc(t.id)}"><input type="checkbox" ${t.done?'checked':''} aria-label="Mark ${esc(t.text)} ${t.done?'incomplete':'complete'}"><span>${esc(t.text)}</span><button class="iconbtn" aria-label="Delete task">×</button></div>`).join(''):'<p class="hint">A clear list. A fresh start.</p>';
}
function renderPreview() {
 const l=state.links.find(x=>x.id===previewId);if(!l){previewId=null;return;}
 const category=state.categories.find(c=>c.id===l.category);
 $('previewContent').innerHTML=`<div class="preview-detail" style="--card-accent:${colors.includes(l.color)?l.color:colors[0]}">${l.image?`<img class="preview-image" src="${esc(l.image)}" alt="Preview image for ${esc(l.name)}" referrerpolicy="no-referrer">`:`<div class="app-icon">${esc(l.icon||l.name.slice(0,2))}</div>`}<h3>${esc(l.name)}</h3><span class="preview-domain">${esc(hostname(l.url))}</span><p>${esc(l.description||'Your shortcut is ready when you are.')}</p><div class="preview-meta">${esc(category?.name)} · Opened ${l.visits} time${l.visits===1?'':'s'}</div><div class="preview-buttons"><a class="btn primary" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-preview-open>Open website ↗</a><button class="btn" id="embedButton">Live preview</button><button class="btn" id="previewEdit">Edit</button></div><p class="hint">Live previews depend on the website allowing embedding. You can add your own preview image in the link editor.</p></div>`;
 const img=$('previewContent').querySelector('img');if(img)img.addEventListener('error',()=>{img.hidden=true;toast('Preview image could not load. Check its URL in the link editor.');},{once:true});
 $('embedButton').onclick=()=>{const u=new URL(l.url);if(u.origin===location.origin){toast('Open this dashboard directly rather than embedding it inside itself.');return;}$('embedTitle').textContent=l.name;$('embedOpen').href=l.url;$('embedFrame').src=l.url;openDialog('embedDialog');};
 $('previewEdit').onclick=()=>editLink(l.id);
 $('previewContent').querySelector('[data-preview-open]').onclick=()=>recordVisit(l.id);
}
function render() {applyAppearance();clock();renderNav();renderLinks();renderTasks();renderPreview();if(!notesDirty)$('notes').value=state.notes;}
function recordVisit(id) {
 const l=state.links.find(x=>x.id===id);if(!l)return;
 l.visits++;l.lastVisited=Date.now();renderNav();
 api('visit','POST',{id}).catch(e=>toast('Link opened, but usage could not be saved: '+e.message));
}
function editLink(id='') {
 const l=state.links.find(x=>x.id===id);
 $('linkForm').reset();$('linkId').value=id;$('editorTitle').textContent=l?'Edit link':'Add a link';
 $('linkCategory').innerHTML=state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
 if(l){$('linkName').value=l.name;$('linkUrl').value=l.url;$('linkDescription').value=l.description;$('linkCategory').value=l.category;$('linkIcon').value=l.icon;$('linkColor').value=l.color;$('linkPinned').checked=l.pinned;$('linkImage').value=l.image;}
 else if(state.categories.some(c=>c.id===view))$('linkCategory').value=view;
 $('deleteLink').hidden=!l;openDialog('editor');$('linkName').focus();
}
function moveLink(id,offset) {
 const shown=visibleLinks(), i=shown.findIndex(l=>l.id===id), other=shown[i+offset];if(!other)return;
 save(s=>{const a=s.links.findIndex(l=>l.id===id),b=s.links.findIndex(l=>l.id===other.id);[s.links[a],s.links[b]]=[s.links[b],s.links[a]];},'Link moved.').catch(()=>{});$('sort').value='manual';
}
function categories() {
 $('categoryList').innerHTML=state.categories.map(c=>`<div class="category-row" data-id="${esc(c.id)}"><input value="${esc(c.name)}" maxlength="40" aria-label="Rename category ${esc(c.name)}"><span class="count">${state.links.filter(l=>l.category===c.id).length}</span><button class="iconbtn" data-category-action="up" aria-label="Move category up">↑</button><button class="iconbtn" data-category-action="down" aria-label="Move category down">↓</button><button class="iconbtn danger" data-category-action="delete" aria-label="Delete category ${esc(c.name)}">×</button></div>`).join('');
}
function showSettings(tab='appearance') {
 const s=state.settings;$('settingName').value=s.name;$('settingTheme').value=s.theme;$('settingBackground').value=s.background;$('settingTimezone').value=s.timezone;$('settingSeconds').checked=s.seconds;$('settingLayout').value=s.layout||'compact';
 $('settingAccent').innerHTML=$('linkColor').innerHTML;$('settingAccent').value=s.accent;
 settingsTab(tab);openDialog('settingsDialog');
}
function settingsTab(tab) {
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 document.querySelectorAll('.settings-view').forEach(v=>v.hidden=v.id!=='settings-'+tab);
 if(tab==='updates')loadUpdates();
}
async function loadUpdates(check=false) {
 try {
  $('checkUpdates').disabled=true;
  const [u,c]=await Promise.all([api(check?'updates/check':'updates',check?'POST':'GET',check?{}:undefined),api('changelog')]);
  showUpdate(u);$('changelog').textContent=c.text;
 }catch(e){$('updateMessage').textContent=e.message;}finally{$('checkUpdates').disabled=false;}
}
function showUpdate(u) {
 $('installedVersion').textContent=u.current;$('latestVersion').textContent=u.latest||'—';
 $('updateMessage').textContent=u.error||(!u.canUpdate?u.reason:u.state==='updating'?'Preparing the update…':u.state==='restarting'?'Restarting Dash. This page will reconnect automatically.':u.available?'A new release is ready. Your dashboard is backed up before updating.':u.latest?'You’re up to date.':'Check GitHub for a published release.');
 if(u.recovery?.status==='rolled_back')$('updateMessage').textContent+=' Previous update: '+u.recovery.message;
 $('applyUpdate').hidden=!(u.available&&u.canUpdate&&['idle','error'].includes(u.state));
 $('updateLog').hidden=!u.log?.length;$('updateLog').textContent=(u.log||[]).join('\n');
 if(u.notes)$('changelog').textContent=u.notes;
}
function exportBackup() {
 const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='dash-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function events() {
 document.addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(b)closeDialog(b.closest('dialog'));});
 document.querySelectorAll('dialog').forEach(d=>{d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d);}});d.addEventListener('close',()=>{if(d.id==='embedDialog')$('embedFrame').removeAttribute('src');});});
 for(const id of ['mainNav','categoryNav'])$(id).addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b){view=b.dataset.view;renderNav();renderLinks();}});
 $('search').addEventListener('input',renderLinks);$('sort').onchange=renderLinks;
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!document.querySelector('dialog[open]')&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}});
 $('addLink').onclick=$('emptyAdd').onclick=()=>editLink();
 $('linkGrid').addEventListener('click',e=>{
  const b=e.target.closest('[data-action]'),card=e.target.closest('[data-id]');if(!b||!card)return;
  const id=card.dataset.id;
  if(b.dataset.action==='open')recordVisit(id);
  if(b.dataset.action==='edit')editLink(id);
  if(b.dataset.action==='preview'){previewId=id;renderPreview();if(innerWidth<1000)$('previewContent').scrollIntoView({behavior:'smooth',block:'center'});}
  if(b.dataset.action==='pin')save(s=>{const l=s.links.find(x=>x.id===id);l.pinned=!l.pinned;}).catch(()=>{});
  if(b.dataset.action==='up')moveLink(id,-1);if(b.dataset.action==='down')moveLink(id,1);
 });
 $('linkGrid').addEventListener('dragstart',e=>{const c=e.target.closest('[data-id]');if(!c)return;dragged=c.dataset.id;e.dataTransfer.setData('text/plain',dragged);e.dataTransfer.effectAllowed='move';c.classList.add('dragging');});
 $('linkGrid').addEventListener('dragend',()=>{dragged=null;document.querySelectorAll('.dragging').forEach(c=>c.classList.remove('dragging'));});
 $('linkGrid').addEventListener('dragover',e=>{if(dragged)e.preventDefault();});
 $('linkGrid').addEventListener('drop',e=>{e.preventDefault();const target=e.target.closest('[data-id]')?.dataset.id,from=dragged;if(!from||!target||from===target)return;$('sort').value='manual';save(s=>{const a=s.links.findIndex(x=>x.id===from),b=s.links.findIndex(x=>x.id===target);s.links.splice(b,0,s.links.splice(a,1)[0]);},'Order saved.').catch(()=>{});});
 $('linkForm').onsubmit=async e=>{e.preventDefault();try{
  const id=$('linkId').value||uid();const l={id,name:$('linkName').value.trim(),url:validUrl($('linkUrl').value.trim()),description:$('linkDescription').value.trim(),category:$('linkCategory').value,icon:$('linkIcon').value.trim(),color:$('linkColor').value,pinned:$('linkPinned').checked,image:validUrl($('linkImage').value.trim(),true),visits:0,lastVisited:0};
  await save(s=>{const i=s.links.findIndex(x=>x.id===id);if(i>=0)s.links[i]={...l,visits:s.links[i].visits,lastVisited:s.links[i].lastVisited};else s.links.push(l);},'Link saved.');closeDialog($('editor'));
 }catch(e){toast(e.message);}};
 $('deleteLink').onclick=async()=>{const id=$('linkId').value;if(!confirm('Delete this saved link?'))return;try{await save(s=>{s.links=s.links.filter(l=>l.id!==id);},'Link deleted.');if(previewId===id){previewId=null;$('previewContent').innerHTML='<div class="preview-placeholder"><b>Ready for another link.</b><p>Select a preview button on a card.</p></div>';}closeDialog($('editor'));}catch{}};
 $('themeToggle').onclick=()=>save(s=>{s.settings.theme=s.settings.theme==='dark'?'light':'dark';}).catch(()=>{});
 $('layoutSelect').onchange=e=>{const layout=e.target.value;save(s=>{s.settings.layout=layout;s.settings.compact=layout==='compact';}).catch(()=>{});};
 $('fullScreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is unavailable in this browser.');}};
 document.addEventListener('keydown',e=>{
  if(document.body.dataset.layout!=='tv'||document.querySelector('dialog[open]')||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  if(!document.activeElement.matches('.link-main'))return;
  const current=document.activeElement.getBoundingClientRect(),cx=current.left+current.width/2,cy=current.top+current.height/2;
  const candidates=[...$('linkGrid').querySelectorAll('.link-main')].filter(el=>el!==document.activeElement).map(el=>{const r=el.getBoundingClientRect();return {el,dx:r.left+r.width/2-cx,dy:r.top+r.height/2-cy};}).filter(p=>e.key==='ArrowRight'?p.dx>10&&Math.abs(p.dy)<50:e.key==='ArrowLeft'?p.dx<-10&&Math.abs(p.dy)<50:e.key==='ArrowDown'?p.dy>30:p.dy<-30).sort((a,b)=>e.key==='ArrowLeft'||e.key==='ArrowRight'?Math.abs(a.dx)-Math.abs(b.dx):(Math.abs(a.dy)+Math.abs(a.dx)*.5)-(Math.abs(b.dy)+Math.abs(b.dx)*.5));
  if(candidates[0]){e.preventDefault();candidates[0].el.focus();candidates[0].el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});}
 });
 $('addCategory').onclick=$('manageCategories').onclick=()=>{categories();openDialog('categoryDialog');};
 $('categoryForm').onsubmit=async e=>{e.preventDefault();const name=$('categoryName').value.trim();if(!name)return;try{await save(s=>{s.categories.push({id:uid(),name,icon:'◈'});},'Category added.');$('categoryName').value='';categories();}catch{}};
 $('categoryList').addEventListener('change',async e=>{if(e.target.tagName!=='INPUT')return;const id=e.target.closest('[data-id]').dataset.id,name=e.target.value.trim();try{await save(s=>{s.categories.find(c=>c.id===id).name=name;},'Category renamed.');categories();}catch{}});
 $('categoryList').addEventListener('click',async e=>{const b=e.target.closest('[data-category-action]');if(!b)return;const id=b.closest('[data-id]').dataset.id,action=b.dataset.categoryAction;
  if(action==='delete'&&(state.categories.length===1||state.links.some(l=>l.category===id))){toast('Move or delete its links first, and keep at least one category.');return;}
  try{await save(s=>{const i=s.categories.findIndex(c=>c.id===id);if(action==='delete')s.categories.splice(i,1);else{const j=i+(action==='up'?-1:1);if(j>=0&&j<s.categories.length)[s.categories[i],s.categories[j]]=[s.categories[j],s.categories[i]];} });if(!state.categories.some(c=>c.id===view)&&!['all','pinned','recent','frequent'].includes(view)){view='all';render();}categories();}catch{}
 });
 $('notes').oninput=()=>{notesDirty=true;$('noteStatus').textContent='Unsaved changes';};
 $('saveNotes').onclick=async()=>{const value=$('notes').value;try{await save(s=>{s.notes=value;});if($('notes').value===value){notesDirty=false;$('noteStatus').textContent=demo?'Saved in this browser':'Saved on your server';}toast('Note saved.');}catch{}};
 window.addEventListener('beforeunload',e=>{if(notesDirty){e.preventDefault();e.returnValue='';}});
 $('taskForm').onsubmit=async e=>{e.preventDefault();const value=$('taskInput').value.trim();if(!value)return;try{await save(s=>{s.tasks.push({id:uid(),text:value,done:false});});$('taskInput').value='';}catch{}};
 $('tasks').addEventListener('change',e=>{const id=e.target.closest('[data-id]')?.dataset.id;if(id)save(s=>{s.tasks.find(t=>t.id===id).done=e.target.checked;}).catch(()=>{});});
 $('tasks').addEventListener('click',e=>{const b=e.target.closest('button'),id=b?.closest('[data-id]')?.dataset.id;if(id)save(s=>{s.tasks=s.tasks.filter(t=>t.id!==id);}).catch(()=>{});});
 $('openSettings').onclick=()=>showSettings();
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>settingsTab(b.dataset.tab));
 $('settingsForm').onsubmit=async e=>{e.preventDefault();try{new Intl.DateTimeFormat('en-GB',{timeZone:$('settingTimezone').value});await save(s=>{s.settings={name:$('settingName').value.trim(),theme:$('settingTheme').value,background:$('settingBackground').value,timezone:$('settingTimezone').value.trim(),accent:$('settingAccent').value,seconds:$('settingSeconds').checked,layout:$('settingLayout').value,compact:$('settingLayout').value==='compact'};},'Preferences saved.');}catch(e){toast(e.message);}};
 $('exportData').onclick=exportBackup;$('importButton').onclick=()=>$('importFile').click();
 $('importFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>4*1024*1024)throw new Error('Maximum backup size is 4 MB.');const imported=JSON.parse(await f.text());if(imported.schema!==1)throw new Error('Choose a valid Dash JSON backup.');if(!confirm('Replace this dashboard with the backup? A server snapshot will be made first.'))return;await api('backup','POST',{});await save(s=>{const rev=s.revision;Object.keys(s).forEach(k=>delete s[k]);Object.assign(s,imported,{revision:rev});},'Dashboard imported.');notesDirty=false;previewId=null;$('previewContent').innerHTML='<div class="preview-placeholder"><b>Your space is restored.</b><p>Select a link preview to see more.</p></div>';view='all';render();closeDialog($('settingsDialog'));}catch(e){toast(e.message);}finally{$('importFile').value='';}};
 $('backupData').onclick=async()=>{try{const r=await api('backup','POST',{});toast(demo?r.filename:'Snapshot created: '+r.filename);}catch(e){toast(e.message);}};
 $('checkUpdates').onclick=()=>loadUpdates(true);
 $('applyUpdate').onclick=async()=>{try{await queue;$('applyUpdate').hidden=true;const u=await api('updates/apply','POST',{});showUpdate(u);let ticks=0;clearInterval(updateTimer);updateTimer=setInterval(async()=>{ticks++;try{const [health,next]=await Promise.all([api('health'),api('updates')]);showUpdate(next);if(next.state==='error'){clearInterval(updateTimer);return;}if(health.version!==u.current||next.recovery?.status==='rolled_back'&&next.state==='idle'){clearInterval(updateTimer);location.reload();}}catch{}if(ticks>120){clearInterval(updateTimer);error('Dash has not reconnected yet. Check docker compose logs dash, then reload this page.');}},1500);}catch(e){toast(e.message);loadUpdates();}};
 bulkEvents();
 $('starterButton').onclick=()=>{$('starterHost').value=demo?'server.local':location.hostname;$('starterOptions').innerHTML=starterApps.map(([name,port],i)=>`<label class="starter-choice"><input type="checkbox" value="${i}" ${i<3||i===7?'checked':''}><span>${esc(name)}<small>Port ${port}</small></span></label>`).join('');openDialog('starterDialog');};
 $('starterForm').onsubmit=async e=>{e.preventDefault();try{let host=$('starterHost').value.trim();if(host.includes(':')&&!host.startsWith('['))host='['+host+']';const base=new URL('http://'+host);if(base.pathname!=='/'||base.port||base.username||base.password||base.search||base.hash)throw new Error('Enter a server IP or hostname, without a port or path.');const selected=[...$('starterOptions').querySelectorAll('input:checked')].map(x=>starterApps[Number(x.value)]);if(!selected.length)throw new Error('Select at least one app.');await save(s=>{let cat=s.categories.find(c=>c.id==='homelab'||c.name.toLowerCase()==='homelab');if(!cat){cat={id:uid(),name:'Homelab',icon:'▣'};s.categories.push(cat);}selected.forEach(([name,port,path,icon,description],i)=>{const url=(port===9443?'https://':'http://')+host+':'+port+path;if(!s.links.some(l=>l.url===url))s.links.push({id:uid(),name,url,icon,description,category:cat.id,color:colors[i%6],pinned:true,image:'',visits:0,lastVisited:0});});},'Homelab shortcuts added. Edit any card to change its port.');closeDialog($('starterDialog'));view='all';render();}catch(e){toast(e.message);}};
}
function openBulk() {
 $('bulkCategory').innerHTML=state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
 if(state.categories.some(c=>c.id===view))$('bulkCategory').value=view;
 $('bulkText').value='';$('shortcutFiles').value='';bulkRows=[];renderBulk();openDialog('bulkDialog');
}
function renderBulk() {
 const ready=bulkRows.filter(r=>r.status==='ready'),selected=ready.filter(r=>r.selected).length;
 $('bulkSummary').hidden=!bulkRows.length;$('bulkReview').hidden=!bulkRows.length;
 $('bulkSummary').textContent=`${selected} selected · ${bulkRows.filter(r=>r.status==='duplicate').length} duplicates skipped · ${bulkRows.filter(r=>r.status==='invalid').length} invalid. Import adds links to your dashboard; existing links stay in place.`;
 $('applyBulk').disabled=!selected;$('applyBulk').textContent=selected?`Import ${selected} link${selected===1?'':'s'}`:'Import selected links';
 $('bulkSelectAll').checked=!!ready.length&&selected===ready.length;$('bulkSelectAll').indeterminate=selected>0&&selected<ready.length;
 const fallback=state.categories.find(c=>c.id===$('bulkCategory').value)?.name||state.categories[0].name;
 $('bulkRows').innerHTML=bulkRows.map((r,i)=>`<tr class="import-${r.status}"><td><input type="checkbox" data-bulk-index="${i}" aria-label="Import ${esc(r.name||r.url)}" ${r.selected?'checked':''} ${r.status==='ready'?'':'disabled'}></td><td>${esc(r.name||r.source||'Unnamed link')}</td><td class="import-url">${esc(r.url)}</td><td>${esc(r.category||fallback)}</td><td><span class="import-status">${r.status==='ready'?'Ready':r.status==='duplicate'?'Duplicate':'Invalid'}</span>${r.error?`<small>${esc(r.error)}</small>`:''}</td></tr>`).join('');
}
function reviewBulk(rows) {if(rows.length>2000)throw new Error('Import at most 2,000 rows at a time.');bulkRows=DashImport.review(rows,state.links);renderBulk();}
function bulkEvents() {
 $('bulkImport').onclick=openBulk;
 $('reviewBulk').onclick=()=>{try{if(new Blob([$('bulkText').value]).size>4*1024*1024)throw new Error('Maximum pasted text size is 4 MB.');const rows=DashImport.parse($('bulkText').value);if(!rows.length)throw new Error('Paste a link list first.');reviewBulk(rows);}catch(e){toast(e.message);}};
 $('chooseShortcutFiles').onclick=()=>$('shortcutFiles').click();
 $('shortcutFiles').onchange=async e=>{const button=$('chooseShortcutFiles');button.disabled=true;try{const files=[...e.target.files];if(!files.length)return;if(files.reduce((n,f)=>n+f.size,0)>4*1024*1024)throw new Error('Keep the combined files under 4 MB.');if(files.length>2000)throw new Error('Choose at most 2,000 shortcut files.');const rows=[];for(const f of files){if(/\.lnk$/i.test(f.name)){rows.push(...DashImport.parse('',f.name));continue;}const bytes=new Uint8Array(await f.arrayBuffer());rows.push(...DashImport.parse(DashImport.decode(bytes),f.name));if(rows.length>2000)throw new Error('Import at most 2,000 rows at a time.');}reviewBulk(rows);}catch(e){toast(e.message);}finally{button.disabled=false;$('shortcutFiles').value='';}};
 $('bulkRows').onchange=e=>{if(e.target.dataset.bulkIndex!==undefined){bulkRows[Number(e.target.dataset.bulkIndex)].selected=e.target.checked;renderBulk();}};
 $('bulkSelectAll').onchange=e=>{bulkRows.filter(r=>r.status==='ready').forEach(r=>r.selected=e.target.checked);renderBulk();};
 $('bulkCategory').onchange=renderBulk;
 $('applyBulk').onclick=async()=>{
  const button=$('applyBulk'),selected=bulkRows.filter(r=>r.status==='ready'&&r.selected),fallback=$('bulkCategory').value,pinned=$('bulkPinned').checked;
  if(!selected.length)return;button.disabled=true;let added=0;
  try{await queue;await api('backup','POST',{});await save(s=>{
   const seen=new Set(s.links.map(l=>DashImport.canonical(l.url)));
   for(const r of selected){if(seen.has(r.url))continue;if(s.links.length>=2000)throw new Error('The dashboard supports 2,000 saved links. Nothing was imported.');
    let category=s.categories.find(c=>c.id===fallback)||s.categories[0];
    if(r.category){category=s.categories.find(c=>c.name.toLowerCase()===r.category.toLowerCase());if(!category){if(s.categories.length>=50)throw new Error('The import would exceed 50 categories. Nothing was imported.');category={id:uid(),name:r.category,icon:'◈'};s.categories.push(category);}}
    s.links.push({id:uid(),name:r.name,url:r.url,category:category.id,description:r.description,icon:r.name.slice(0,2).toUpperCase(),color:colors[added%colors.length],pinned,image:'',visits:0,lastVisited:0});seen.add(r.url);added++;
   }
  });toast(`${added} link${added===1?'':'s'} imported. Existing links kept.`);closeDialog($('bulkDialog'));view='all';$('search').value='';render();
  }catch(e){toast(e.message);renderBulk();}
 };
}
async function boot() {
 if(demo){$('demoBanner').hidden=false;$('connection').textContent='BROWSER DEMO';$('saveState').textContent='Demo · stored in this browser';$('noteStatus').textContent='Saved in this browser';}
 try{state=await api('state');events();render();const h=await api('health');$('version').textContent=h.version;setInterval(clock,1000);}catch(e){$('errorBanner').textContent='Could not load Dash: '+e.message+'. Reload after checking your server connection.';$('errorBanner').hidden=false;$('connection').textContent='DISCONNECTED';}
}
boot();
