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
    notes:[],
    tasks:[]
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
function isoToday(){ return new Date().toISOString().slice(0,10); }
function dateObj(iso){ if(!iso) return null; const d=new Date(iso+"T00:00:00"); return isNaN(d)?null:d; }
function daysBetween(a,b){ const x=new Date(a); x.setHours(0,0,0,0); const y=new Date(b); y.setHours(0,0,0,0); return Math.round((y-x)/86400000); }
function dateFr(iso){ const d=dateObj(iso); return d?d.toLocaleDateString('fr-FR'):'Non défini'; }
function countdownLabel(endIso){ const d=dateObj(endIso); if(!d) return 'Aucune fin définie'; const diff=daysBetween(new Date(), d); if(diff<0) return `En retard de ${Math.abs(diff)} j`; if(diff===0) return 'Dernier jour'; if(diff===1) return 'Demain'; return `${diff} j restants`; }
function normalizeProfileItem(p){ if(typeof p === 'string') p={text:p}; return {done:false,text:'',priority:'normale',start_date:'',end_date:'',status:'',...p}; }
function profileIsUrgent(p){ p=normalizeProfileItem(p); return p.priority==='urgent' && !p.done; }
function profileIsLate(p){ p=normalizeProfileItem(p); const d=dateObj(p.end_date); if(!d || p.done) return false; return d < dateObj(isoToday()); }
function profileStartsToday(p){ p=normalizeProfileItem(p); return p.start_date === isoToday() && !p.done; }
function profileCard(p,n){ p=normalizeProfileItem(p); return `<div class="profile-alert-card ${profileIsLate(p)?'task-late':''}"><div><span class="task-priority ${p.priority==='urgent'?'priority-urgent':'priority-mid'}">${p.priority==='urgent'?'Urgent':'Normal'}</span><h3>${esc(p.text||'Profil sans nom')}</h3><p>${esc(p.status||'')}</p><small>Début : ${dateFr(p.start_date)} • Fin : ${dateFr(p.end_date)} • ${countdownLabel(p.end_date)}</small><small>Note : ${esc(n?.title||'')}</small></div><button class="secondary-btn" onclick="openNote('${n.id}')">Ouvrir</button></div>`; }


function defaultNote(){
  const now = new Date();
  return {
    id: uid(), owner_id: activeUser()?.id || currentProfile?.id || "local-admin", user_email: activeUser()?.email || currentProfile?.email || "",
    title:"SÉANCE HEBDOMADAIRE – RÉUNION DU LUNDI", date:todayFr(), week:weekNumber(now), year:now.getFullYear(),
    missionStart:"", missionEnd:"", sessionDate:new Date().toISOString().slice(0,10), reminderTime:"09:00", status:"planned",
    debtors:Array.from({length:10},()=>({done:false,client:"",amount:"",action:"",notes:""})),
    profiles:Array.from({length:10},()=>({done:false,text:"",priority:"normale",start_date:"",end_date:"",status:""})),
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
  merged.profiles = (merged.profiles||[]).map(normalizeProfileItem);
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
  initNav(); renderUsers(); await renderDashboard(); await renderNotes(); await renderTasks(); await renderCalendar(); await renderStats(); await renderArchives(); renderSearch(); renderAssistant(); renderSettings(); await renderAdmin();
}
function initNav(){
  qsa(".nav-btn[data-view]").forEach(btn=>btn.onclick=async()=>{
    qsa(".nav-btn").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#"+btn.dataset.view).classList.add("active-view");
    if(btn.dataset.view==="dashboard") await renderDashboard();
    if(btn.dataset.view==="notes") await renderNotes();
    if(btn.dataset.view==="tasks") await renderTasks();
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
  sel.onchange=async e=>{state.currentUserId=e.target.value; saveLocal(); await renderDashboard(); await renderNotes(); await renderTasks(); await renderCalendar(); await renderStats(); await renderArchives();};
}

function defaultTask(){
  const d = new Date();
  const today = d.toISOString().slice(0,10);
  return {
    id: uid(),
    owner_id: activeUser()?.id || currentProfile?.id || "local-admin",
    user_email: activeUser()?.email || currentProfile?.email || "",
    title: "",
    description: "",
    category: "Général",
    priority: "moyenne",
    status: "todo",
    pinned: false,
    start_date: today,
    due_date: today,
    end_date: today,
    week: weekNumber(d),
    year: d.getFullYear(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
function normalizeTask(t){
  const n={...defaultTask(), ...t, id:String(t.id ?? uid())};
  n.category = n.category || 'Général';
  n.start_date = n.start_date || n.due_date || isoToday();
  n.end_date = n.end_date || n.due_date || n.start_date || isoToday();
  n.due_date = n.due_date || n.end_date;
  n.pinned = !!n.pinned;
  return n;
}
function taskIsUrgent(t){ return (t.priority === "urgente" || t.priority === "haute" || t.pinned) && t.status !== "done"; }
function taskIsLate(t){
  t=normalizeTask(t);
  if(!t.end_date || t.status === "done") return false;
  const today = dateObj(isoToday());
  const due = dateObj(t.end_date);
  return due && due < today;
}
function taskDueToday(t){
  t=normalizeTask(t);
  if(t.status === "done") return false;
  const today=isoToday();
  return t.start_date === today || t.end_date === today || t.due_date === today;
}
function taskStartsSoon(t){
  t=normalizeTask(t);
  const d=dateObj(t.start_date); if(!d || t.status==='done') return false;
  const diff=daysBetween(new Date(), d); return diff>=0 && diff<=3;
}
function taskEndLabel(t){ t=normalizeTask(t); return countdownLabel(t.end_date || t.due_date); }
async function loadTasks(){
  if(localMode) return (state.tasks||[]).map(normalizeTask);
  let q = supabaseClient.from("tasks").select("*").order("due_date",{ascending:true}).order("created_at",{ascending:false});
  if(!isAdmin()) q=q.eq("owner_id", currentProfile.id);
  else if(state.currentUserId && state.currentUserId !== "all") q=q.eq("owner_id", state.currentUserId);
  const {data,error}=await q;
  if(error){ toast("Lecture des tâches impossible, fallback local"); return (state.tasks||[]).map(normalizeTask); }
  return (data||[]).map(normalizeTask);
}
async function upsertTask(task){
  task = normalizeTask(task);
  task.updated_at = new Date().toISOString();
  if(localMode){
    state.tasks = state.tasks || [];
    const i=state.tasks.findIndex(t=>String(t.id)===String(task.id));
    if(i>=0) state.tasks[i]=task; else state.tasks.unshift(task);
    saveLocal(); return;
  }
  const payload={
    id:String(task.id), owner_id:task.owner_id || activeUser()?.id || currentProfile.id, user_email:task.user_email || activeUser()?.email || currentProfile.email,
    title:task.title, description:task.description, category:task.category || "Général", priority:task.priority, status:task.status, pinned:!!task.pinned, start_date:task.start_date, due_date:task.end_date || task.due_date, end_date:task.end_date || task.due_date,
    week:task.week || weekNumber(new Date((task.end_date || task.due_date || Date.now()))), year:task.year || new Date().getFullYear(),
    created_at:task.created_at, updated_at:task.updated_at
  };
  const {error}=await supabaseClient.from("tasks").upsert(payload);
  if(error) throw error;
}
async function removeTask(id){
  if(localMode){ state.tasks=(state.tasks||[]).filter(t=>String(t.id)!==String(id)); saveLocal(); return; }
  const {error}=await supabaseClient.from("tasks").delete().eq("id", String(id));
  if(error) throw error;
}
function taskCard(t){
  t=normalizeTask(t);
  const pClass = t.priority === "urgente" ? "priority-urgent" : t.priority === "haute" ? "priority-high" : t.priority === "basse" ? "priority-low" : "priority-mid";
  return `<div class="task-card ${t.status==='done'?'task-done':''} ${taskIsLate(t)?'task-late':''} ${t.pinned?'task-pinned':''}">
    <div class="task-main"><div class="task-badges"><span class="task-priority ${pClass}">${esc(t.priority)}</span>${t.pinned?'<span class="task-priority priority-urgent">Épinglée</span>':''}<span class="task-priority priority-mid">${esc(t.category||'Général')}</span></div><h3>${esc(t.title||'Tâche sans titre')}</h3><p>${esc(t.description||'')}</p><small>Début : ${dateFr(t.start_date)} • Fin : ${dateFr(t.end_date)} • ${taskEndLabel(t)} • ${esc(t.user_email||'')}</small>${taskIsLate(t)?'<b class="status-bad">En retard</b>':''}${taskStartsSoon(t)?'<b class="status-warn">Commence bientôt</b>':''}</div>
    <div class="note-actions"><button class="secondary-btn" onclick="toggleTaskDone('${t.id}')">${t.status==='done'?'Réouvrir':'Terminer'}</button><button class="secondary-btn" onclick="editTask('${t.id}')">Modifier</button><button class="secondary-btn danger" onclick="deleteTask('${t.id}')">Supprimer</button></div>
  </div>`;
}
async function renderTasks(){
  const tasks = visibleNotes(await loadTasks());
  const open = tasks.filter(t=>t.status !== 'done');
  const done = tasks.filter(t=>t.status === 'done');
  qs("#tasks").innerHTML=`<div class="glass"><div class="row-flex"><div><h1>Tâches de la semaine</h1><p>Gère les priorités, les urgences et les choses à faire.</p></div><button class="primary-btn" onclick="newTaskForm()">Nouvelle tâche</button></div>
  <div class="stats-grid"><div class="glass stat-card"><small>Ouvertes</small><h2>${open.length}</h2></div><div class="glass stat-card"><small>Urgentes</small><h2>${open.filter(taskIsUrgent).length}</h2></div><div class="glass stat-card"><small>Aujourd'hui</small><h2>${open.filter(taskDueToday).length}</h2></div><div class="glass stat-card"><small>En retard</small><h2>${open.filter(taskIsLate).length}</h2></div></div>
  <div id="taskFormArea"></div></div>
  <div class="grid-2"><div class="glass"><h2>À faire</h2><div class="toolbar"><select id="taskFilter" onchange="filterTasks()"><option value="all">Toutes</option><option value="urgente">Urgentes</option><option value="haute">Haute priorité</option><option value="moyenne">Moyenne</option><option value="basse">Basse</option><option value="late">En retard</option><option value="pinned">Épinglées</option></select><input id="taskSearch" oninput="filterTasks()" placeholder="Rechercher une tâche..."></div><div id="taskOpenList">${open.map(taskCard).join('') || "<div class='empty'>Aucune tâche ouverte.</div>"}</div></div><div class="glass"><h2>Terminées</h2>${done.slice(0,20).map(taskCard).join('') || "<div class='empty'>Aucune tâche terminée.</div>"}</div></div>`;
}
function taskForm(t=defaultTask()){
  t=normalizeTask(t);
  return `<div class="glass task-form"><h2>${t.title?'Modifier la tâche':'Nouvelle tâche'}</h2><label>Titre</label><input id="taskTitle" value="${esc(t.title)}" placeholder="Ex : Relancer clients urgents"><label>Description</label><textarea id="taskDescription" placeholder="Détails de la tâche...">${esc(t.description)}</textarea><div class="grid-3"><div><label>Catégorie</label><input id="taskCategory" value="${esc(t.category||'Général')}" placeholder="Travail, client, admin..."></div><div><label>Priorité</label><select id="taskPriority"><option value="basse">Basse</option><option value="moyenne">Moyenne</option><option value="haute">Haute</option><option value="urgente">Urgente</option></select></div><div><label>Statut</label><select id="taskStatus"><option value="todo">À faire</option><option value="in_progress">En cours</option><option value="done">Terminée</option></select></div></div><div class="grid-3"><div><label>Début mission</label><input id="taskStart" type="date" value="${esc(t.start_date||'')}"></div><div><label>Fin mission</label><input id="taskEnd" type="date" value="${esc(t.end_date||t.due_date||'')}"></div><div><label>Épingler</label><label class="checkline"><input type="checkbox" id="taskPinned" ${t.pinned?'checked':''}> Afficher en haut du dashboard</label></div></div><div class="note-actions" style="margin-top:18px"><button class="primary-btn" onclick="saveTaskForm('${t.id}')">Enregistrer</button><button class="secondary-btn" onclick="qs('#taskFormArea').innerHTML=''">Annuler</button></div></div>`;
}
function newTaskForm(){ qs('#taskFormArea').innerHTML=taskForm(defaultTask()); qs('#taskPriority').value='moyenne'; qs('#taskStatus').value='todo'; if(qs('#taskPinned')) qs('#taskPinned').checked=false; qs('#taskTitle').focus(); }
async function editTask(id){ const tasks=await loadTasks(); const t=tasks.find(x=>String(x.id)===String(id)); if(!t) return toast('Tâche introuvable'); qs('#taskFormArea').innerHTML=taskForm(t); qs('#taskPriority').value=t.priority||'moyenne'; qs('#taskStatus').value=t.status||'todo'; if(qs('#taskPinned')) qs('#taskPinned').checked=!!t.pinned; qs('#taskTitle').focus(); window.scrollTo({top:0,behavior:'smooth'}); }
async function saveTaskForm(id){
  try{
    const existing=(await loadTasks()).find(t=>String(t.id)===String(id));
    const base=existing || defaultTask();
    const start=qs('#taskStart').value || isoToday();
    const end=qs('#taskEnd').value || start;
    const d=new Date(end+'T00:00:00');
    const task={...base,title:qs('#taskTitle').value.trim(),description:qs('#taskDescription').value.trim(),category:qs('#taskCategory').value.trim()||'Général',priority:qs('#taskPriority').value,status:qs('#taskStatus').value,pinned:!!qs('#taskPinned')?.checked,start_date:start,end_date:end,due_date:end,week:weekNumber(d),year:d.getFullYear(),owner_id:base.owner_id || activeUser()?.id || currentProfile.id,user_email:base.user_email || activeUser()?.email || currentProfile.email};
    if(!task.title) return toast('Ajoute un titre à la tâche.');
    await upsertTask(task); toast('Tâche sauvegardée'); await renderTasks(); await renderDashboard(); await renderStats();
  }catch(e){ toast('Erreur tâche : '+e.message); }
}
async function toggleTaskDone(id){ const tasks=await loadTasks(); const t=tasks.find(x=>String(x.id)===String(id)); if(!t) return; t.status=t.status==='done'?'todo':'done'; await upsertTask(t); await renderTasks(); await renderDashboard(); await renderStats(); }
async function deleteTask(id){ if(!confirm('Supprimer cette tâche ?')) return; await removeTask(id); toast('Tâche supprimée'); await renderTasks(); await renderDashboard(); await renderStats(); }
async function filterTasks(){
  const all=(await loadTasks()).filter(t=>t.status!=='done');
  const f=qs('#taskFilter')?.value || 'all'; const q=(qs('#taskSearch')?.value || '').toLowerCase();
  const list=all.filter(t=>{
    t=normalizeTask(t);
    const okF=f==='all' || (f==='late'?taskIsLate(t):(f==='pinned'?t.pinned:t.priority===f));
    const okQ=!q || JSON.stringify(t).toLowerCase().includes(q);
    return okF && okQ;
  });
  qs('#taskOpenList').innerHTML=list.map(taskCard).join('') || "<div class='empty'>Aucune tâche trouvée.</div>";
}

async function renderDashboard(){
  const notes = visibleNotes(await loadNotes()); const active=notes.filter(n=>!n.archived);
  const tasks = visibleNotes(await loadTasks()).map(normalizeTask); const openTasks=tasks.filter(t=>t.status!=="done");
  const checks = active.reduce((t,n)=>t+["debtors","profiles","placements","urgent"].reduce((a,k)=>a+(n[k]||[]).filter(i=>i.done).length,0),0);
  const placements = active.reduce((a,n)=>a+(n.placements||[]).filter(p=>p.name||p.client||p.notes).length,0);
  const urgent = active.reduce((a,n)=>a+(n.urgent||[]).filter(u=>u.client||u.request||u.priority).length,0);
  const urgentTasks = openTasks.filter(taskIsUrgent).sort((a,b)=>(b.pinned-a.pinned)||String(a.end_date).localeCompare(String(b.end_date)));
  const lateTasks = openTasks.filter(taskIsLate);
  const urgentProfiles = active.flatMap(n=>(n.profiles||[]).map(p=>({p:normalizeProfileItem(p),n}))).filter(x=>profileIsUrgent(x.p)||profileIsLate(x.p)||profileStartsToday(x.p));
  qs("#dashboard").innerHTML=`
  <div class="glass"><div class="row-flex"><div><h1>Dashboard Premium</h1><p>Semaine ${weekNumber(new Date())} • ${new Date().getFullYear()}</p></div><div class="note-actions"><button class="primary-btn" onclick="goNew()">Créer une nouvelle note</button><button class="secondary-btn" onclick="openTasksPage()">Voir les tâches</button></div></div>
  <div class="stats-grid"><div class="glass stat-card"><small>Notes actives</small><h2>${active.length}</h2></div><div class="glass stat-card"><small>Tâches ouvertes</small><h2>${openTasks.length}</h2></div><div class="glass stat-card urgent-stat"><small>Tâches urgentes</small><h2>${urgentTasks.length}</h2></div><div class="glass stat-card urgent-stat"><small>Profils urgents</small><h2>${urgentProfiles.length}</h2></div><div class="glass stat-card"><small>Tâches en retard</small><h2>${lateTasks.length}</h2></div><div class="glass stat-card"><small>Tâches complétées notes</small><h2>${checks}</h2></div><div class="glass stat-card"><small>Profils à placer</small><h2>${placements}</h2></div><div class="glass stat-card"><small>Commandes urgentes</small><h2>${urgent}</h2></div></div></div>
  <div class="grid-2"><div class="glass"><h2>Profils urgents / missions</h2>${urgentProfiles.slice(0,8).map(x=>profileCard(x.p,x.n)).join("")||"<div class='empty'>Aucun profil urgent.</div>"}</div><div class="glass"><h2>Tâches urgentes & épinglées</h2>${urgentTasks.slice(0,6).map(taskCard).join("")||"<div class='empty'>Aucune tâche urgente.</div>"}</div></div>
  <div class="grid-2"><div class="glass"><h2>Timeline immédiate</h2>${timelineWidget(openTasks, urgentProfiles)}</div><div class="glass"><h2>Historique récent</h2>${activityFeed(active,tasks).slice(0,7).map(x=>`<div class="activity-row"><b>${esc(x.title)}</b><small>${esc(x.meta)}</small></div>`).join("")||"<div class='empty'>Aucune activité.</div>"}</div></div>
  <div class="glass"><h2>Activité réelle</h2>${activityChart(active)}<div class="note-actions" style="margin-top:18px"><button class="secondary-btn" onclick="requestNotify()">Activer notifications</button><button class="secondary-btn" onclick="exportCSV()">Export CSV</button></div></div>`;
  scheduleBrowserReminders(active, openTasks);
}
function noteCardMini(n){ return `<div style="margin-top:16px"><strong>${esc(n.title)}</strong><p>${esc(n.date)} • Semaine ${esc(n.week)}</p><small>${esc((n.summary||"").slice(0,130))}</small></div>`; }
function goNew(){ qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#newnote").classList.add("active-view"); qsa(".nav-btn").forEach(b=>b.classList.remove("active")); renderEditor(defaultNote(), true); }
async function openTasksPage(){ qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#tasks").classList.add("active-view"); qsa(".nav-btn").forEach(b=>b.classList.remove("active")); const b=qs('.nav-btn[data-view="tasks"]'); if(b) b.classList.add("active"); await renderTasks(); }
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
function tableProfiles(n,r){return `<div class="glass scroll"><h2>Profils Disponibles</h2><table><tr><th></th><th>Urgence</th><th>Profil</th><th>Début mission</th><th>Fin mission</th><th>Statut / notes</th></tr>${n.profiles.map((raw,i)=>{const p=normalizeProfileItem(raw); return `<tr><td><input type="checkbox" data-k="profiles" data-i="${i}" ${p.done?"checked":""} ${rowDisabled(r)}></td><td><select class="table-input" id="profile-priority-${i}" ${rowDisabled(r)}><option value="normale" ${p.priority!=='urgent'?'selected':''}>Pas urgent</option><option value="urgent" ${p.priority==='urgent'?'selected':''}>Urgent</option></select></td><td><input class="table-input" id="profile-${i}" value="${esc(p.text)}" ${rowDisabled(r)}></td><td><input class="table-input" type="date" id="profile-start-${i}" value="${esc(p.start_date||'')}" ${rowDisabled(r)}></td><td><input class="table-input" type="date" id="profile-end-${i}" value="${esc(p.end_date||'')}" ${rowDisabled(r)}></td><td><input class="table-input" id="profile-status-${i}" value="${esc(p.status||'')}" ${rowDisabled(r)}></td></tr>`}).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('profiles')">Ajouter ligne</button>`}</div>`}
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

function timelineWidget(tasks, urgentProfiles){
  const rows=[];
  tasks.forEach(t=>{t=normalizeTask(t); if(taskDueToday(t) || taskIsLate(t) || taskStartsSoon(t)) rows.push({type:'Tâche', title:t.title, meta:`${t.category||'Général'} • ${taskEndLabel(t)}`, urgent:taskIsUrgent(t)||taskIsLate(t)});});
  urgentProfiles.forEach(({p,n})=>rows.push({type:'Profil', title:p.text||'Profil urgent', meta:`${p.priority==='urgent'?'Urgent':'À suivre'} • début ${dateFr(p.start_date)} • fin ${dateFr(p.end_date)} • ${n.title}`, urgent:true}));
  return rows.slice(0,8).map(x=>`<div class="timeline-row ${x.urgent?'urgent-line':''}"><span>${esc(x.type)}</span><div><b>${esc(x.title)}</b><small>${esc(x.meta)}</small></div></div>`).join('') || "<div class='empty'>Aucune urgence immédiate.</div>";
}
function activityFeed(notes,tasks){
  const items=[];
  notes.forEach(n=>items.push({date:n.updated_at||n.created_at,title:n.title||'Note',meta:`Note modifiée • ${n.user_email||''}`}));
  tasks.forEach(t=>items.push({date:t.updated_at||t.created_at,title:t.title||'Tâche',meta:`${t.status==='done'?'Terminée':'À suivre'} • ${t.priority||'moyenne'} • ${dateFr(t.end_date||t.due_date)}`}));
  return items.sort((a,b)=>new Date(b.date)-new Date(a.date));
}
function taskActivityChart(tasks){
  const days=[...Array(7)].map((_,i)=>{const d=new Date(); d.setDate(d.getDate()-6+i); return d;});
  const counts=days.map(d=>tasks.filter(t=>new Date(t.updated_at||t.created_at).toDateString()===d.toDateString()).length);
  const max=Math.max(1,...counts);
  return `<div class="chart">${counts.map((c,i)=>`<div class="bar-wrap"><div class="bar" title="${c} action(s)" style="height:${40+(c/max)*150}px"></div><small>${days[i].toLocaleDateString('fr-FR',{weekday:'short'}).slice(0,3)}</small></div>`).join('')}</div>`;
}
function donutChart(parts){
  const total=parts.reduce((a,p)=>a+p.value,0)||1;
  let acc=0;
  const stops=parts.map(p=>{const start=acc; acc+=p.value/total*100; return `${p.color} ${start}% ${acc}%`;}).join(',');
  return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})"><span>${Math.round(parts[0]?.value/total*100||0)}%</span></div><div>${parts.map(p=>`<p><i style="background:${p.color}"></i>${esc(p.label)} : <b>${p.value}</b></p>`).join('')}</div></div>`;
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
  const tasks=visibleNotes(await loadTasks()).map(normalizeTask);
  const active=notes.filter(n=>!n.archived);
  const done=active.filter(n=>n.status==='done').length;
  const planned=active.filter(n=>n.status!=='done').length;
  const avg=active.length?Math.round(active.reduce((a,n)=>a+noteScore(n),0)/active.length):0;
  const taskOpen=tasks.filter(t=>t.status!=='done');
  const taskDone=tasks.filter(t=>t.status==='done').length;
  const urgentProfiles=active.flatMap(n=>(n.profiles||[]).map(p=>normalizeProfileItem(p))).filter(p=>profileIsUrgent(p)||profileIsLate(p));
  const users={}; active.forEach(n=>users[n.user_email||'Sans email']=(users[n.user_email||'Sans email']||0)+1);
  const cat={}; taskOpen.forEach(t=>cat[t.category||'Général']=(cat[t.category||'Général']||0)+1);
  qs("#stats").innerHTML=`<div class="glass"><h1>Centre statistiques premium</h1><div class="stats-grid"><div class="glass stat-card"><small>Séances terminées</small><h2>${done}</h2></div><div class="glass stat-card"><small>Séances à suivre</small><h2>${planned}</h2></div><div class="glass stat-card"><small>Progression moyenne</small><h2>${avg}%</h2></div><div class="glass stat-card"><small>Tâches ouvertes</small><h2>${taskOpen.length}</h2></div><div class="glass stat-card urgent-stat"><small>Tâches urgentes</small><h2>${taskOpen.filter(taskIsUrgent).length}</h2></div><div class="glass stat-card urgent-stat"><small>Profils urgents</small><h2>${urgentProfiles.length}</h2></div><div class="glass stat-card"><small>Tâches terminées</small><h2>${taskDone}</h2></div><div class="glass stat-card"><small>Fichiers joints</small><h2>${active.reduce((a,n)=>a+(n.attachments||[]).length,0)}</h2></div></div></div><div class="grid-2"><div class="glass"><h2>Activité tâches sur 7 jours</h2>${taskActivityChart(tasks)}</div><div class="glass"><h2>Répartition tâches</h2>${donutChart([{label:'Ouvertes',value:taskOpen.length,color:'#22d3ee'},{label:'Terminées',value:taskDone,color:'#9cffc0'},{label:'Urgentes',value:taskOpen.filter(taskIsUrgent).length,color:'#fb7185'}])}</div></div><div class="grid-2"><div class="glass"><h2>Tâches par priorité</h2>${['urgente','haute','moyenne','basse'].map(p=>{const c=taskOpen.filter(t=>t.priority===p).length; const max=Math.max(1,taskOpen.length); return `<div class="progress-row"><span>${p}</span><div class="progress"><i style="width:${Math.min(100,c/max*100)}%"></i></div><b>${c}</b></div>`}).join('')}</div><div class="glass"><h2>Tâches par catégorie</h2>${Object.entries(cat).map(([k,c])=>`<div class="progress-row"><span>${esc(k)}</span><div class="progress"><i style="width:${Math.min(100,c/Math.max(1,...Object.values(cat))*100)}%"></i></div><b>${c}</b></div>`).join('')||"<div class='empty'>Aucune tâche ouverte.</div>"}</div></div><div class="glass"><h2>Progression par note</h2>${active.slice(0,12).map(n=>`<div class="progress-row"><span>${esc(n.title).slice(0,36)}</span><div class="progress"><i style="width:${noteScore(n)}%"></i></div><b>${noteScore(n)}%</b></div>`).join("")||"<div class='empty'>Aucune donnée.</div>"}</div>`;
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
function scheduleBrowserReminders(notes, tasks=[]){
  if(!state.settings.notifications || !('Notification' in window) || Notification.permission!=='granted') return;
  const now=new Date();
  notes.forEach(n=>{
    if(!n.sessionDate || !n.reminderTime) return;
    const at=new Date(`${n.sessionDate}T${n.reminderTime}:00`);
    const diff=at-now;
    const key=`note-${n.id}-${n.sessionDate}-${n.reminderTime}`;
    if(diff>0 && diff<2147483647 && !notifiedReminders.has(key)){
      notifiedReminders.add(key);
      setTimeout(()=>new Notification('Rappel séance', {body:n.title||'Séance à traiter'}), diff);
    }
  });
  tasks.forEach(t=>{
    t=normalizeTask(t);
    if(!taskDueToday(t) && !taskIsLate(t)) return;
    const key=`task-${t.id}-${isoToday()}`;
    if(!notifiedReminders.has(key)){
      notifiedReminders.add(key);
      setTimeout(()=>new Notification(taskIsLate(t)?'Tâche en retard':'Tâche à traiter aujourd’hui', {body:t.title||'Tâche'}), 1200);
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
