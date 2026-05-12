const STORE_KEY = "seance-hebdomadaire-suite-v3";
const BUCKET = "attachments";

const qs = (s) => document.querySelector(s);
const qsa = (s) => [...document.querySelectorAll(s)];
const esc = (v="") => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
const uid = () => Date.now() + Math.floor(Math.random()*9999);

let supabaseClient = null;
let currentSession = null;
let currentProfile = null;
let currentEditingNote = null;
let localMode = false;

const state = loadLocal();

function loadLocal(){
  const fallback = {
    users:[{id:"local-admin", email:"admin@local", full_name:"Admin", role:"admin"}],
    currentUserId:"local-admin",
    settings:{theme:"dark", autosave:true, notifications:true, compact:false},
    notes:[]
  };
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || fallback; } catch { return fallback; }
}
function saveLocal(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function toast(msg){ const t=qs("#toast"); t.innerText=msg; t.style.display="block"; setTimeout(()=>t.style.display="none",2600); }
function weekNumber(d){ d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7)); const y=new Date(Date.UTC(d.getUTCFullYear(),0,1)); return Math.ceil((((d-y)/86400000)+1)/7); }
function todayFr(){ return new Date().toLocaleDateString("fr-FR"); }
function nowFr(){ return new Date().toLocaleString("fr-FR"); }
function isAdmin(){ return currentProfile?.role === "admin"; }
function activeUser(){ return state.users.find(u=>u.id===state.currentUserId) || currentProfile || state.users[0]; }

function defaultNote(){
  const now = new Date();
  return {
    id: uid(), owner_id: activeUser()?.id || currentProfile?.id || "local-admin", user_email: activeUser()?.email || currentProfile?.email || "",
    title:"SÉANCE HEBDOMADAIRE – RÉUNION DU LUNDI", date:todayFr(), week:weekNumber(now), year:now.getFullYear(),
    missionStart:"", missionEnd:"", sessionDate:new Date().toISOString().slice(0,10), reminderTime:"09:00", status:"planned",
    debtors:Array.from({length:10},()=>({done:false,client:"",amount:"",action:"",notes:""})),
    profiles:Array.from({length:10},()=>({done:false,text:""})),
    placements:Array.from({length:10},()=>({done:false,name:"",client:"",notes:""})),
    rdv:Array.from({length:6},()=>({text:""})),
    urgent:Array.from({length:8},()=>({done:false,priority:"",client:"",request:"",contact:"",status:""})),
    divers:"", attachments:[], summary:"", archived:false, modifiedBy: activeUser()?.full_name || "Admin", modifiedAt: nowFr(), created_at:new Date().toISOString(), updated_at:new Date().toISOString()
  };
}
function normalizeNote(n){
  const attachments=n.attachments||[];
  const meta=attachments.find(a=>a && a.system && a.kind==="meta") || {};
  const merged={...defaultNote(), ...n, ...meta, debtors:n.debtors||[], profiles:n.profiles||[], placements:n.placements||[], rdv:n.rdv||[], urgent:n.urgent||[], attachments:attachments};
  if(!merged.sessionDate && merged.date){
    const parts=String(merged.date).split('/');
    if(parts.length===3) merged.sessionDate=`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  return merged;
}

async function init(){
  setupAuthTabs();
  const configured = window.SUPABASE_URL && window.SUPABASE_ANON_KEY;
  if(configured && window.supabase){
    supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    const {data} = await supabaseClient.auth.getSession();
    currentSession = data.session;
    supabaseClient.auth.onAuthStateChange((_event, session)=>{ currentSession=session; if(session) bootApp(); else showAuth(); });
    if(currentSession) await bootApp(); else showAuth();
  } else {
    localMode = true;
    qs("#localModeNotice").innerHTML = "Mode local actif : ajoute tes clés dans <b>config.js</b> pour activer Supabase, la connexion réelle, les rôles admin et les données partagées.";
    currentProfile = state.users[0];
    showApp();
    await renderAll();
  }
  setTimeout(()=>qs("#loader").style.display="none",500);
}

function setupAuthTabs(){
  qsa(".auth-tab").forEach(btn=>btn.onclick=()=>{
    qsa(".auth-tab").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    qsa(".auth-panel").forEach(p=>p.classList.remove("active-auth-panel"));
    qs(btn.dataset.auth === "login" ? "#authLogin" : "#authSignup").classList.add("active-auth-panel");
  });
  qs("#loginBtn").onclick = login;
  qs("#signupBtn").onclick = signup;
  qs("#logoutBtn").onclick = logout;
}
async function login(){
  if(localMode){ currentProfile=state.users[0]; showApp(); renderAll(); return; }
  const email=qs("#loginEmail").value.trim(); const password=qs("#loginPassword").value;
  const {error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error) return toast(error.message);
  toast("Connexion réussie");
}
async function signup(){
  if(localMode) return toast("Configure Supabase dans config.js pour créer des comptes réels.");
  const full_name=qs("#signupName").value.trim(); const email=qs("#signupEmail").value.trim(); const password=qs("#signupPassword").value;
  const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{full_name}}});
  if(error) return toast(error.message);
  if(data.user) await ensureProfile(data.user, full_name);
  toast("Compte créé. Connecte-toi ou confirme l'email si demandé.");
}
async function logout(){ if(localMode){showAuth(); return;} await supabaseClient.auth.signOut(); }
function showAuth(){ qs("#authScreen").style.display="flex"; qs("#appShell").style.display="none"; }
function showApp(){ qs("#authScreen").style.display="none"; qs("#appShell").style.display="flex"; }

async function ensureProfile(user, fullName=""){
  const email=user.email || "";
  const adminEmails = (window.ADMIN_EMAILS || []).map(e=>String(e).toLowerCase());
  const defaultRole = adminEmails.includes(email.toLowerCase()) ? "admin" : "user";
  const {data} = await supabaseClient.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if(data) return data;
  const profile={id:user.id,email,full_name:fullName || user.user_metadata?.full_name || email.split("@")[0],role:defaultRole,created_at:new Date().toISOString()};
  await supabaseClient.from("profiles").insert(profile);
  return profile;
}
async function bootApp(){
  const {data:{user}} = await supabaseClient.auth.getUser();
  if(!user) return showAuth();
  currentProfile = await ensureProfile(user);
  await loadUsers();
  if(!state.currentUserId) state.currentUserId = currentProfile.id;
  showApp(); await renderAll();
}
async function loadUsers(){
  if(localMode) return;
  let {data,error}=await supabaseClient.from("profiles").select("id,email,full_name,role,created_at").order("full_name");
  if(error || !data?.length) data=[currentProfile];
  state.users=data; if(!isAdmin()) state.currentUserId=currentProfile.id; saveLocal();
}
async function loadNotes(){
  if(localMode) return state.notes.map(normalizeNote);
  let q = supabaseClient.from("weekly_notes").select("*").order("updated_at",{ascending:false});
  if(!isAdmin()) q=q.eq("owner_id", currentProfile.id);
  else if(state.currentUserId && state.currentUserId !== "all") q=q.eq("owner_id", state.currentUserId);
  const {data,error}=await q;
  if(error){ toast("Lecture Supabase impossible, fallback local"); return state.notes.map(normalizeNote); }
  return (data||[]).map(row=>normalizeNote({...row, id: row.id}));
}
async function upsertNote(note){
  note.updated_at = new Date().toISOString(); note.modifiedAt=nowFr(); note.modifiedBy=activeUser()?.full_name || currentProfile?.full_name || "Utilisateur";
  if(localMode){ const i=state.notes.findIndex(n=>n.id===note.id); if(i>=0) state.notes[i]=note; else state.notes.unshift(note); saveLocal(); return; }
  const safeAttachments=(note.attachments||[]).filter(a=>!(a && a.system && a.kind==="meta"));
  safeAttachments.unshift({system:true, kind:"meta", sessionDate:note.sessionDate, reminderTime:note.reminderTime, status:note.status});
  const payload={
    id:String(note.id), owner_id:note.owner_id || activeUser()?.id || currentProfile.id, user_email:note.user_email, title:note.title, date:note.date,
    week:note.week, year:note.year, missionStart:note.missionStart, missionEnd:note.missionEnd, debtors:note.debtors, profiles:note.profiles,
    placements:note.placements, rdv:note.rdv, urgent:note.urgent, divers:note.divers, attachments:safeAttachments, summary:note.summary,
    archived:note.archived, modifiedBy:note.modifiedBy, modifiedAt:note.modifiedAt, created_at:note.created_at, updated_at:note.updated_at
  };
  const {error}=await supabaseClient.from("weekly_notes").upsert(payload);
  if(error) throw error;
}
async function removeNote(id){
  if(localMode){ state.notes=state.notes.filter(n=>String(n.id)!==String(id)); saveLocal(); return; }
  const {error}=await supabaseClient.from("weekly_notes").delete().eq("id", String(id)); if(error) throw error;
}
function canEdit(note){ return isAdmin() || note.owner_id === currentProfile?.id; }
function visibleNotes(notes){ return notes.filter(n => isAdmin() || n.owner_id === currentProfile?.id); }

async function renderAll(){
  document.body.classList.toggle("is-admin", isAdmin()); document.body.classList.toggle("light", state.settings.theme==="light");
  qs("#roleLabel").innerHTML = isAdmin()?"<span class='status-ok'>Administrateur</span>":"Utilisateur";
  qs("#currentEmail").innerText = currentProfile?.email || "Mode local";
  initNav(); renderUsers(); await renderDashboard(); await renderNotes(); await renderCalendar(); await renderStats(); await renderArchives(); renderSearch(); renderAssistant(); renderSettings(); await renderAdmin();
}
function initNav(){
  qsa(".nav-btn[data-view]").forEach(btn=>btn.onclick=async()=>{
    qsa(".nav-btn").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#"+btn.dataset.view).classList.add("active-view");
    if(btn.dataset.view==="dashboard") await renderDashboard();
    if(btn.dataset.view==="notes") await renderNotes();
    if(btn.dataset.view==="calendar") await renderCalendar();
    if(btn.dataset.view==="stats") await renderStats();
    if(btn.dataset.view==="archives") await renderArchives();
    if(btn.dataset.view==="search") renderSearch();
    if(btn.dataset.view==="assistant") renderAssistant();
    if(btn.dataset.view==="settings") renderSettings();
    if(btn.dataset.view==="admin") await renderAdmin();
  });
}
function renderUsers(){
  const sel=qs("#userSelect");
  const opts = isAdmin() ? [{id:"all",full_name:"Tous les utilisateurs",email:""}, ...state.users] : [currentProfile];
  sel.innerHTML=opts.map(u=>`<option value="${esc(u.id)}" ${u.id===state.currentUserId?"selected":""}>${esc(u.full_name||u.email)}</option>`).join("");
  sel.onchange=async e=>{state.currentUserId=e.target.value; saveLocal(); await renderDashboard(); await renderNotes(); await renderCalendar(); await renderStats(); await renderArchives();};
}
async function renderDashboard(){
  const notes = visibleNotes(await loadNotes()); const active=notes.filter(n=>!n.archived);
  const checks = active.reduce((t,n)=>t+["debtors","profiles","placements","urgent"].reduce((a,k)=>a+(n[k]||[]).filter(i=>i.done).length,0),0);
  const placements = active.reduce((a,n)=>a+(n.placements||[]).filter(p=>p.name||p.client||p.notes).length,0);
  const urgent = active.reduce((a,n)=>a+(n.urgent||[]).filter(u=>u.client||u.request||u.priority).length,0);
  qs("#dashboard").innerHTML=`
  <div class="glass"><div class="row-flex"><div><h1>Dashboard Premium</h1><p>Semaine ${weekNumber(new Date())} • ${new Date().getFullYear()}</p></div><button class="primary-btn" onclick="goNew()">Créer une nouvelle note</button></div>
  <div class="stats-grid"><div class="glass stat-card"><small>Notes actives</small><h2>${active.length}</h2></div><div class="glass stat-card"><small>Tâches complétées</small><h2>${checks}</h2></div><div class="glass stat-card"><small>Profils à placer</small><h2>${placements}</h2></div><div class="glass stat-card"><small>Commandes urgentes</small><h2>${urgent}</h2></div></div></div>
  <div class="grid-2"><div class="glass"><h2>Historique récent</h2>${active.slice(0,6).map(noteCardMini).join("")||"<div class='empty'>Aucune note.</div>"}</div><div class="glass"><h2>Activité réelle</h2>${activityChart(active)}<div class="note-actions" style="margin-top:18px"><button class="secondary-btn" onclick="requestNotify()">Activer notifications</button><button class="secondary-btn" onclick="exportCSV()">Export CSV</button></div></div></div>`;
  scheduleBrowserReminders(active);
}
function noteCardMini(n){ return `<div style="margin-top:16px"><strong>${esc(n.title)}</strong><p>${esc(n.date)} • Semaine ${esc(n.week)}</p><small>${esc((n.summary||"").slice(0,130))}</small></div>`; }
function goNew(){ qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#newnote").classList.add("active-view"); qsa(".nav-btn").forEach(b=>b.classList.remove("active")); renderEditor(defaultNote(), true); }
function renderEditor(note,isNew=false){ currentEditingNote = normalizeNote(note); const readonly = !canEdit(currentEditingNote); qs("#newnote").innerHTML=`
<div class="glass"><div class="note-header"><div><input id="title" value="${esc(currentEditingNote.title)}" ${readonly?"disabled":""}/><p>Date: ${esc(currentEditingNote.date)} • Semaine ${esc(currentEditingNote.week)}</p></div><div class="note-actions"><span class="badge" id="saveBadge">${isNew?"Nouvelle note":"Sauvegardé"}</span>${readonly?"":`<button class="primary-btn" onclick="saveCurrent()">Sauvegarder</button><button class="secondary-btn" onclick="duplicateNote('${currentEditingNote.id}')">Dupliquer</button><button class="secondary-btn" onclick="toggleArchive('${currentEditingNote.id}')">${currentEditingNote.archived?"Désarchiver":"Archiver"}</button>`}<button class="secondary-btn" onclick="window.print()">Export PDF</button></div></div>
<div class="grid-2"><div class="glass"><label>Nombre de débuts de mission</label><input id="missionStart" value="${esc(currentEditingNote.missionStart)}" ${readonly?"disabled":""}/></div><div class="glass"><label>Nombre de fins de mission</label><input id="missionEnd" value="${esc(currentEditingNote.missionEnd)}" ${readonly?"disabled":""}/></div></div>
${tableDebtors(currentEditingNote,readonly)}${tableProfiles(currentEditingNote,readonly)}${tablePlacements(currentEditingNote,readonly)}${tableRdv(currentEditingNote,readonly)}${tableUrgent(currentEditingNote,readonly)}
<div class="glass"><h2>Résumé de la séance</h2><textarea id="summary" ${readonly?"disabled":""}>${esc(currentEditingNote.summary)}</textarea></div>
<div class="glass"><h2>Pièces jointes</h2>${readonly?"":`<input type="file" id="attachments" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"/>`}<div id="previewArea" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:18px">${(currentEditingNote.attachments||[]).map(filePreview).join("")}</div></div>
<div class="glass"><h2>Divers</h2><textarea id="divers" ${readonly?"disabled":""}>${esc(currentEditingNote.divers)}</textarea></div></div>`;
 qsa("input,textarea,select").forEach(el=>el.addEventListener("input",()=>{const b=qs("#saveBadge"); if(b) b.innerText="Modifications non enregistrées";}));
}
function rowDisabled(r){return r?"disabled":""}
function tableDebtors(n,r){return `<div class="glass scroll"><h2>Débiteurs à Relancer</h2><table><tr><th></th><th>Client</th><th>Montant</th><th>Action</th><th>Notes</th></tr>${n.debtors.map((d,i)=>`<tr><td><input type="checkbox" data-k="debtors" data-i="${i}" ${d.done?"checked":""} ${rowDisabled(r)}></td><td><input class="table-input" id="deb-client-${i}" value="${esc(d.client)}" ${rowDisabled(r)}></td><td><input class="table-input" id="deb-amount-${i}" value="${esc(d.amount)}" ${rowDisabled(r)}></td><td><input class="table-input" id="deb-action-${i}" value="${esc(d.action)}" ${rowDisabled(r)}></td><td><input class="table-input" id="deb-notes-${i}" value="${esc(d.notes)}" ${rowDisabled(r)}></td></tr>`).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('debtors')">Ajouter ligne</button>`}</div>`}
function tableProfiles(n,r){return `<div class="glass scroll"><h2>Profils Disponibles</h2><table>${n.profiles.map((p,i)=>`<tr><td><input type="checkbox" data-k="profiles" data-i="${i}" ${p.done?"checked":""} ${rowDisabled(r)}></td><td><input class="table-input" id="profile-${i}" value="${esc(p.text)}" ${rowDisabled(r)}></td></tr>`).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('profiles')">Ajouter ligne</button>`}</div>`}
function tablePlacements(n,r){return `<div class="glass scroll"><h2>Profils à Placer</h2><table><tr><th></th><th>Nom</th><th>Client</th><th>Notes</th></tr>${n.placements.map((p,i)=>`<tr><td><input type="checkbox" data-k="placements" data-i="${i}" ${p.done?"checked":""} ${rowDisabled(r)}></td><td><input class="table-input" id="place-name-${i}" value="${esc(p.name)}" ${rowDisabled(r)}></td><td><input class="table-input" id="place-client-${i}" value="${esc(p.client)}" ${rowDisabled(r)}></td><td><input class="table-input" id="place-notes-${i}" value="${esc(p.notes)}" ${rowDisabled(r)}></td></tr>`).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('placements')">Ajouter ligne</button>`}</div>`}
function tableRdv(n,r){return `<div class="glass scroll"><h2>RDV à Prévoir</h2>${n.rdv.map((x,i)=>`<input id="rdv-${i}" value="${esc(x.text)}" placeholder="RDV ${i+1}" ${rowDisabled(r)}/>`).join("")}${r?"":`<button class="primary-btn" onclick="addRow('rdv')">Ajouter ligne</button>`}</div>`}
function tableUrgent(n,r){return `<div class="glass scroll"><h2>Commandes Urgentes</h2><table><tr><th></th><th>Priorité</th><th>Client</th><th>Demande</th><th>Contact</th><th>Statut</th></tr>${n.urgent.map((u,i)=>`<tr><td><input type="checkbox" data-k="urgent" data-i="${i}" ${u.done?"checked":""} ${rowDisabled(r)}></td><td><input class="table-input" id="urg-priority-${i}" value="${esc(u.priority)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-client-${i}" value="${esc(u.client)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-request-${i}" value="${esc(u.request)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-contact-${i}" value="${esc(u.contact)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-status-${i}" value="${esc(u.status)}" ${rowDisabled(r)}></td></tr>`).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('urgent')">Ajouter ligne</button>`}</div>`}
function addRow(type){ const rows={debtors:{done:false,client:"",amount:"",action:"",notes:""},profiles:{done:false,text:""},placements:{done:false,name:"",client:"",notes:""},urgent:{done:false,priority:"",client:"",request:"",contact:"",status:""},rdv:{text:""}}; currentEditingNote[type].push(rows[type]); renderEditor(currentEditingNote,false); }
function collectNote(){ const n=currentEditingNote; n.title=qs("#title").value; n.sessionDate=qs("#sessionDate")?.value || n.sessionDate || new Date().toISOString().slice(0,10); n.date=new Date(n.sessionDate+"T00:00:00").toLocaleDateString("fr-FR"); n.reminderTime=qs("#reminderTime")?.value || n.reminderTime || "09:00"; n.status=qs("#status")?.value || n.status || "planned"; n.missionStart=qs("#missionStart").value; n.missionEnd=qs("#missionEnd").value; n.summary=qs("#summary").value; n.divers=qs("#divers").value; n.owner_id=n.owner_id||activeUser()?.id||currentProfile?.id; n.user_email=activeUser()?.email||currentProfile?.email||""; qsa("input[type=checkbox][data-k]").forEach(cb=>{n[cb.dataset.k][Number(cb.dataset.i)].done=cb.checked}); n.debtors.forEach((d,i)=>{d.client=qs(`#deb-client-${i}`)?.value||"";d.amount=qs(`#deb-amount-${i}`)?.value||"";d.action=qs(`#deb-action-${i}`)?.value||"";d.notes=qs(`#deb-notes-${i}`)?.value||""}); n.profiles.forEach((p,i)=>p.text=qs(`#profile-${i}`)?.value||""); n.placements.forEach((p,i)=>{p.name=qs(`#place-name-${i}`)?.value||"";p.client=qs(`#place-client-${i}`)?.value||"";p.notes=qs(`#place-notes-${i}`)?.value||""}); n.rdv.forEach((r,i)=>r.text=qs(`#rdv-${i}`)?.value||""); n.urgent.forEach((u,i)=>{u.priority=qs(`#urg-priority-${i}`)?.value||"";u.client=qs(`#urg-client-${i}`)?.value||"";u.request=qs(`#urg-request-${i}`)?.value||"";u.contact=qs(`#urg-contact-${i}`)?.value||"";u.status=qs(`#urg-status-${i}`)?.value||""}); return n; }
async function saveCurrent(){ try{ const n=collectNote(); await handleFiles(n); await upsertNote(n); currentEditingNote=n; qs("#saveBadge").innerText="Sauvegardé"; toast("Note sauvegardée"); await renderDashboard(); } catch(e){ toast("Erreur sauvegarde : "+e.message); } }
async function handleFiles(note){ const files=qs("#attachments")?.files || []; if(!files.length) return; for(const file of files){ if(localMode || !supabaseClient){ const data=await fileToDataURL(file); note.attachments.push({name:file.name,type:file.type,url:data,local:true}); } else { const path=`${note.owner_id}/${note.id}/${Date.now()}-${file.name}`; const {error}=await supabaseClient.storage.from(BUCKET).upload(path,file,{upsert:true}); if(error){ note.attachments.push({name:file.name,type:file.type,url:await fileToDataURL(file),local:true}); } else { const {data}=supabaseClient.storage.from(BUCKET).getPublicUrl(path); note.attachments.push({name:file.name,type:file.type,path,url:data.publicUrl}); } } } }
function fileToDataURL(file){ return new Promise(res=>{const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file);}); }
function filePreview(f){ if(typeof f === "string") f={url:f,name:"image"}; const isImg=(f.type||"").startsWith("image") || String(f.url).startsWith("data:image"); return `<div class="file-card">${isImg?`<img src="${esc(f.url)}">`:`<div class="empty">Fichier</div>`}<a href="${esc(f.url)}" target="_blank">${esc(f.name||"Pièce jointe")}</a></div>`; }
async function renderNotes(){ const notes=(await loadNotes()).filter(n=>!n.archived); qs("#notes").innerHTML=`<div class="glass"><div class="row-flex"><h1>Mes Notes</h1><button class="primary-btn" onclick="goNew()">Nouvelle note</button></div>${notes.map(noteCard).join("")||"<div class='empty'>Aucune note.</div>"}</div>`; }
function noteCard(n){ return `<div class="glass"><div class="row-flex"><div><h2>${esc(n.title)}</h2><p>${esc(n.date)} • Semaine ${esc(n.week)} • <span class="pill">${esc(n.user_email||"")}</span></p><small>${esc((n.summary||"").slice(0,150))}</small><p class="muted">Modifié par ${esc(n.modifiedBy||"")} le ${esc(n.modifiedAt||"")}</p></div><div class="note-actions"><button class="primary-btn" onclick="openNote('${n.id}')">Ouvrir</button>${canEdit(n)?`<button class="secondary-btn" onclick="deleteNote('${n.id}')">Supprimer</button>`:""}</div></div></div>`; }
async function openNote(id){ const notes=await loadNotes(); const n=notes.find(x=>String(x.id)===String(id)); qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#newnote").classList.add("active-view"); renderEditor(n,false); }
async function deleteNote(id){ if(!confirm("Supprimer cette note ?")) return; try{ await removeNote(id); toast("Note supprimée"); await renderNotes(); await renderDashboard(); } catch(e){toast(e.message)} }
async function duplicateNote(id){ const notes=await loadNotes(); const src=notes.find(n=>String(n.id)===String(id)) || currentEditingNote; const copy=normalizeNote(JSON.parse(JSON.stringify(src))); copy.id=uid(); copy.date=todayFr(); copy.week=weekNumber(new Date()); copy.year=new Date().getFullYear(); copy.title=copy.title+" – Copie"; copy.owner_id=activeUser()?.id||currentProfile.id; await upsertNote(copy); toast("Note dupliquée"); await renderNotes(); }
async function toggleArchive(id){ const notes=await loadNotes(); const n=notes.find(x=>String(x.id)===String(id))||currentEditingNote; n.archived=!n.archived; await upsertNote(n); toast(n.archived?"Note archivée":"Note désarchivée"); await renderArchives(); await renderNotes(); }
async function renderArchives(){ const notes=(await loadNotes()).filter(n=>n.archived || true); const grouped={}; notes.forEach(n=>{grouped[n.year]=grouped[n.year]||{}; grouped[n.year][n.week]=grouped[n.year][n.week]||[]; grouped[n.year][n.week].push(n);}); let html='<div class="glass"><h1>Archives</h1>'; Object.keys(grouped).sort((a,b)=>b-a).forEach(y=>{html+=`<div class="archive-group"><h2>${y}</h2>`; Object.keys(grouped[y]).sort((a,b)=>b-a).forEach(w=>{html+=`<div class="glass"><h3>Semaine ${w}</h3>${grouped[y][w].map(n=>`<p><strong style="cursor:pointer" onclick="openNote('${n.id}')">${esc(n.title)}</strong> - ${esc(n.date)} ${n.archived?"<span class='pill'>Archivée</span>":""}<br><small>${esc((n.summary||"").slice(0,180))}</small></p>`).join("")}</div>`}); html+='</div>';}); qs("#archives").innerHTML=html+'</div>'; }
function renderSearch(){ qs("#search").innerHTML=`<div class="glass"><h1>Recherche globale</h1><input id="searchInput" placeholder="Rechercher contenu, client, semaine, utilisateur..."/><div class="search-results" id="results"></div></div>`; qs("#searchInput").oninput=async e=>{const q=e.target.value.toLowerCase(); const notes=await loadNotes(); const found=q?notes.filter(n=>JSON.stringify(n).toLowerCase().includes(q)):[]; qs("#results").innerHTML=found.map(n=>`<div class="glass" onclick="openNote('${n.id}')"><h3>${esc(n.title)}</h3><p>${esc(n.date)} • Semaine ${esc(n.week)}</p><small>${esc((n.summary||"").slice(0,120))}</small></div>`).join("") || (q?"<div class='empty'>Aucun résultat.</div>":""); }; }
function renderSettings(){ qs("#settings").innerHTML=`<div class="glass"><h1>Paramètres</h1><label>Mode</label><select id="themeSel"><option value="dark">Sombre</option><option value="light">Clair</option></select><label style="margin-top:14px"><input type="checkbox" id="notifSel" ${state.settings.notifications?"checked":""}> Notifications navigateur</label><label><input type="checkbox" id="compactSel" ${state.settings.compact?"checked":""}> Affichage compact</label><div class="note-actions" style="margin-top:20px"><button class="primary-btn" onclick="applyTheme()">Appliquer paramètres</button><button class="secondary-btn" onclick="requestNotify()">Autoriser notifications</button><button class="secondary-btn" onclick="exportData()">Exporter JSON</button><button class="secondary-btn" onclick="exportCSV()">Exporter CSV</button><button class="secondary-btn" onclick="importData()">Importer JSON</button><button class="secondary-btn" onclick="resetLocal()">Reset local</button></div><input type="file" id="importFile" style="display:none" accept=".json"/><div class="empty"><b>Supabase :</b> ${supabaseClient?"connecté":"non configuré"}<br><b>Rôle :</b> ${esc(currentProfile?.role||"local")}<br><b>Clé anon :</b> configurée dans config.js</div></div>`; qs("#themeSel").value=state.settings.theme; }
function applyTheme(){ state.settings.theme=qs("#themeSel").value; state.settings.notifications=!!qs("#notifSel")?.checked; state.settings.compact=!!qs("#compactSel")?.checked; document.body.classList.toggle("light",state.settings.theme==="light"); document.body.classList.toggle("compact",state.settings.compact); saveLocal(); toast("Paramètres appliqués"); }
function exportData(){ const blob=new Blob([JSON.stringify({state,currentProfile},null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="seance-hebdomadaire-export.json"; a.click(); }
function importData(){ qs("#importFile").click(); qs("#importFile").onchange=e=>{const file=e.target.files[0]; const r=new FileReader(); r.onload=()=>{const data=JSON.parse(r.result); Object.assign(state,data.state||data); saveLocal(); location.reload();}; r.readAsText(file);}; }
function resetLocal(){ if(confirm("Effacer le cache local ?")){localStorage.removeItem(STORE_KEY); location.reload();} }
async function renderAdmin(){ if(!isAdmin()){qs("#admin").innerHTML="<div class='glass'><h1>Admin</h1><div class='empty'>Accès réservé aux administrateurs.</div></div>"; return;} const notes=await loadNotes(); qs("#admin").innerHTML=`<div class="glass"><h1>Administration</h1><div class="stats-grid"><div class="glass stat-card"><small>Utilisateurs</small><h2>${state.users.length}</h2></div><div class="glass stat-card"><small>Notes visibles</small><h2>${notes.length}</h2></div><div class="glass stat-card"><small>Admins</small><h2>${state.users.filter(u=>u.role==="admin").length}</h2></div></div><h2>Utilisateurs</h2><div class="scroll"><table><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Action</th></tr>${state.users.map(u=>`<tr><td>${esc(u.full_name||"")}</td><td>${esc(u.email||"")}</td><td><select id="role-${esc(u.id)}"><option value="user" ${u.role!=="admin"?"selected":""}>user</option><option value="admin" ${u.role==="admin"?"selected":""}>admin</option></select></td><td><button class="secondary-btn" onclick="updateRole('${u.id}')">Enregistrer</button></td></tr>`).join("")}</table></div><h2 style="margin-top:22px">Toutes les notes</h2>${notes.map(noteCard).join("")||"<div class='empty'>Aucune note.</div>"}</div>`; }
async function updateRole(id){ const role=qs(`#role-${CSS.escape(id)}`).value; if(localMode){const u=state.users.find(x=>x.id===id); if(u)u.role=role; saveLocal(); toast("Rôle local modifié"); return;} const {error}=await supabaseClient.from("profiles").update({role}).eq("id",id); if(error) return toast(error.message); await loadUsers(); toast("Rôle mis à jour"); await renderAdmin(); }


function parseNoteDate(n){
  if(n.sessionDate) return new Date(n.sessionDate+"T00:00:00");
  if(n.created_at) return new Date(n.created_at);
  return new Date();
}
function noteScore(n){
  const total=["debtors","profiles","placements","urgent"].reduce((a,k)=>a+(n[k]||[]).length,0) || 1;
  const done=["debtors","profiles","placements","urgent"].reduce((a,k)=>a+(n[k]||[]).filter(x=>x.done).length,0);
  return Math.round((done/total)*100);
}
function activityChart(notes){
  const days=[...Array(7)].map((_,i)=>{const d=new Date(); d.setDate(d.getDate()-6+i); return d;});
  const counts=days.map(d=>notes.filter(n=>parseNoteDate(n).toDateString()===d.toDateString()).length);
  const max=Math.max(1,...counts);
  return `<div class="chart">${counts.map((c,i)=>`<div class="bar-wrap"><div class="bar" title="${c} note(s)" style="height:${40+(c/max)*150}px"></div><small>${days[i].toLocaleDateString('fr-FR',{weekday:'short'}).slice(0,3)}</small></div>`).join("")}</div>`;
}
async function renderCalendar(){
  const notes=visibleNotes(await loadNotes());
  const base=new Date();
  const first=new Date(base.getFullYear(), base.getMonth(), 1);
  const last=new Date(base.getFullYear(), base.getMonth()+1, 0);
  let cells="";
  for(let i=1;i<=(first.getDay()||7)-1;i++) cells+=`<div class="cal-cell muted-cell"></div>`;
  for(let d=1; d<=last.getDate(); d++){
    const iso=new Date(base.getFullYear(),base.getMonth(),d).toISOString().slice(0,10);
    const dayNotes=notes.filter(n=>(n.sessionDate||"")===iso);
    cells+=`<div class="cal-cell"><div class="cal-day">${d}</div>${dayNotes.slice(0,3).map(n=>`<button class="cal-note ${esc(n.status||'planned')}" onclick="openNote('${n.id}')">${esc(n.title).slice(0,34)}</button>`).join("")}${dayNotes.length>3?`<small>+${dayNotes.length-3}</small>`:""}</div>`;
  }
  qs("#calendar").innerHTML=`<div class="glass"><div class="row-flex"><div><h1>Calendrier</h1><p>${base.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})}</p></div><button class="primary-btn" onclick="goNew()">Nouvelle séance</button></div><div class="cal-head"><span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span></div><div class="calendar-grid">${cells}</div></div>`;
}
async function renderStats(){
  const notes=visibleNotes(await loadNotes());
  const active=notes.filter(n=>!n.archived);
  const done=active.filter(n=>n.status==='done').length;
  const planned=active.filter(n=>n.status!=='done').length;
  const avg=active.length?Math.round(active.reduce((a,n)=>a+noteScore(n),0)/active.length):0;
  const users={}; active.forEach(n=>users[n.user_email||'Sans email']=(users[n.user_email||'Sans email']||0)+1);
  qs("#stats").innerHTML=`<div class="glass"><h1>Statistiques</h1><div class="stats-grid"><div class="glass stat-card"><small>Séances terminées</small><h2>${done}</h2></div><div class="glass stat-card"><small>Séances à suivre</small><h2>${planned}</h2></div><div class="glass stat-card"><small>Progression moyenne</small><h2>${avg}%</h2></div><div class="glass stat-card"><small>Fichiers joints</small><h2>${active.reduce((a,n)=>a+(n.attachments||[]).length,0)}</h2></div></div></div><div class="grid-2"><div class="glass"><h2>Progression par note</h2>${active.slice(0,12).map(n=>`<div class="progress-row"><span>${esc(n.title).slice(0,36)}</span><div class="progress"><i style="width:${noteScore(n)}%"></i></div><b>${noteScore(n)}%</b></div>`).join("")||"<div class='empty'>Aucune donnée.</div>"}</div><div class="glass"><h2>Répartition utilisateurs</h2>${Object.entries(users).map(([u,c])=>`<div class="progress-row"><span>${esc(u)}</span><div class="progress"><i style="width:${Math.min(100,c/Math.max(...Object.values(users))*100)}%"></i></div><b>${c}</b></div>`).join("")||"<div class='empty'>Aucune donnée.</div>"}</div></div>`;
}
function renderAssistant(){
  qs("#assistant").innerHTML=`<div class="glass"><h1>Assistant local</h1><p>Recherche intelligente, résumé et actions rapides sans service externe.</p><input id="assistantQuery" placeholder="Exemple : séances urgentes, profils, dettes, semaine 12..."><div class="note-actions"><button class="primary-btn" onclick="assistantSearch()">Analyser</button><button class="secondary-btn" onclick="assistantSummary()">Résumé global</button></div><div id="assistantResults" class="search-results"></div></div>`;
}
async function assistantSearch(){
  const q=(qs("#assistantQuery").value||"").toLowerCase();
  const notes=visibleNotes(await loadNotes());
  const found=notes.filter(n=>JSON.stringify(n).toLowerCase().includes(q));
  qs("#assistantResults").innerHTML=found.map(n=>`<div class="glass"><h3>${esc(n.title)}</h3><p>${esc(n.date)} • ${esc(n.status||'planned')} • progression ${noteScore(n)}%</p><button class="secondary-btn" onclick="openNote('${n.id}')">Ouvrir</button></div>`).join("") || "<div class='empty'>Aucun résultat.</div>";
}
async function assistantSummary(){
  const notes=visibleNotes(await loadNotes()).filter(n=>!n.archived);
  const urgent=notes.flatMap(n=>(n.urgent||[]).filter(u=>u.client||u.request).map(u=>`${u.priority||'Priorité'} — ${u.client||'Client'} : ${u.request||''}`)).slice(0,10);
  const late=notes.filter(n=>n.status==='late').slice(0,8);
  qs("#assistantResults").innerHTML=`<div class="glass"><h2>Résumé automatique</h2><p>${notes.length} note(s) active(s), progression moyenne ${notes.length?Math.round(notes.reduce((a,n)=>a+noteScore(n),0)/notes.length):0}%.</p><h3>Urgences détectées</h3>${urgent.map(x=>`<p>• ${esc(x)}</p>`).join("")||"<p>Aucune urgence remplie.</p>"}<h3>Séances à suivre</h3>${late.map(n=>`<p>• <b onclick="openNote('${n.id}')" style="cursor:pointer">${esc(n.title)}</b></p>`).join("")||"<p>Aucune séance en retard.</p>"}</div>`;
}
function requestNotify(){
  if(!('Notification' in window)) return toast('Notifications non supportées sur ce navigateur.');
  Notification.requestPermission().then(p=>toast(p==='granted'?'Notifications activées':'Notifications refusées'));
}
const notifiedReminders=new Set();
function scheduleBrowserReminders(notes){
  if(!state.settings.notifications || !('Notification' in window) || Notification.permission!=='granted') return;
  const now=new Date();
  notes.forEach(n=>{
    if(!n.sessionDate || !n.reminderTime) return;
    const at=new Date(`${n.sessionDate}T${n.reminderTime}:00`);
    const diff=at-now;
    const key=`${n.id}-${n.sessionDate}-${n.reminderTime}`;
    if(diff>0 && diff<2147483647 && !notifiedReminders.has(key)){
      notifiedReminders.add(key);
      setTimeout(()=>new Notification('Rappel séance', {body:n.title||'Séance à traiter'}), diff);
    }
  });
}
async function exportCSV(){
  const notes=visibleNotes(await loadNotes());
  const rows=[["titre","date_seance","semaine","annee","email","statut","progression","resume"]].concat(notes.map(n=>[n.title,n.sessionDate||n.date,n.week,n.year,n.user_email,n.status||'',noteScore(n),(n.summary||'').replace(/\n/g,' ')]));
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='seances-export.csv'; a.click();
}

window.addEventListener("load", init);
