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
function dateObj(iso){ if(!iso) return null; const d=new Date(String(iso).slice(0,10)+"T00:00:00"); return isNaN(d)?null:d; }
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
  if(!merged.sessionDate && merged.date){
    const parts=String(merged.date).split('/');
    if(parts.length===3) merged.sessionDate=`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  merged.profiles = (merged.profiles||[]).map(normalizeProfileItem);
  return merged;
}

async function init(){
  try{
    setupAuthTabs();
    const configured = window.SUPABASE_URL && window.SUPABASE_ANON_KEY;
    if(configured && window.supabase){
      supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      const {data} = await supabaseClient.auth.getSession();
      currentSession = data.session;
      supabaseClient.auth.onAuthStateChange((_event, session)=>{
        currentSession=session;
        if(session) bootApp().catch(e=>handleFatalError(e));
        else showAuth();
      });
      if(currentSession) await bootApp(); else showAuth();
    } else {
      localMode = true;
      const notice=qs("#localModeNotice");
      if(notice) notice.innerHTML = "Mode local actif : ajoute tes clés dans <b>config.js</b> pour activer Supabase, la connexion réelle, les rôles admin et les données partagées.";
      currentProfile = state.users[0];
      showApp();
      await renderAll();
    }
  }catch(e){
    handleFatalError(e);
  }finally{
    const loader=qs("#loader");
    if(loader) loader.style.display="none";
  }
}
function handleFatalError(e){
  console.error("Erreur de chargement", e);
  localMode = true;
  currentProfile = currentProfile || state.users[0];
  try{
    showApp();
    renderAll().catch(err=>console.error("Erreur rendu secours", err));
    toast("Le site a démarré en mode secours. Vérifie Supabase/SQL si besoin.");
  }catch(err){
    console.error("Secours impossible", err);
    showAuth();
  }
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
  showApp();
  await renderAll();
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
function visibleItems(items){ return (items||[]).filter(x => isAdmin() || x.owner_id === currentProfile?.id); }

async function renderAll(){
  document.body.classList.toggle("is-admin", isAdmin());
  document.body.classList.toggle("light", state.settings.theme==="light");
  document.body.classList.toggle("compact", !!state.settings.compact);
  const role=qs("#roleLabel"); if(role) role.innerHTML = isAdmin()?"<span class='status-ok'>Administrateur</span>":"Utilisateur";
  const email=qs("#currentEmail"); if(email) email.innerText = currentProfile?.email || "Mode local";
  initNav();
  renderUsers();
  await openViewSafe("dashboard");
  try{ renderSearch(); }catch(e){ console.warn(e); }
  try{ renderAssistant(); }catch(e){ console.warn(e); }
  try{ renderSettings(); }catch(e){ console.warn(e); }
}
async function openViewSafe(view){
  try{
    qsa(".view").forEach(v=>v.classList.remove("active-view"));
    const target=qs("#"+view);
    if(target) target.classList.add("active-view");
    qsa(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.view===view));
    if(view==="newnote") renderEditor(defaultNote(), true);
    if(view==="dashboard") await renderDashboard();
    if(view==="notes") await renderNotes();
    if(view==="tasks") await renderTasks();
    if(view==="calendar") await renderCalendar();
    if(view==="stats") await renderStats();
    if(view==="archives") await renderArchives();
    if(view==="search") renderSearch();
    if(view==="assistant") renderAssistant();
    if(view==="collaborators") renderCollaborators();
    if(view==="settings") renderSettings();
    if(view==="admin") await renderAdmin();
    if(window.innerWidth < 900 && target) target.scrollIntoView({behavior:"smooth", block:"start"});
  }catch(e){
    console.error("Erreur onglet "+view, e);
    const target=qs("#"+view);
    if(target) target.innerHTML=`<div class="glass"><h1>Erreur de chargement</h1><p>${esc(e.message||e)}</p><button class="secondary-btn" onclick="openViewSafe('dashboard')">Retour dashboard</button></div>`;
    toast("Erreur sur l’onglet "+view);
  }finally{
    const loader=qs("#loader"); if(loader) loader.style.display="none";
  }
}
function initNav(){
  qsa(".nav-btn[data-view]").forEach(btn=>btn.onclick=()=>openViewSafe(btn.dataset.view));
}

function renderUsers(){
  const sel=qs("#userSelect");
  const opts = isAdmin() ? [{id:"all",full_name:"Tous les utilisateurs",email:""}, ...state.users] : [currentProfile];
  sel.innerHTML=opts.map(u=>`<option value="${esc(u.id)}" ${u.id===state.currentUserId?"selected":""}>${esc(u.full_name||u.email)}</option>`).join("");
  sel.onchange=async e=>{state.currentUserId=e.target.value; saveLocal(); await renderDashboard(); await renderNotes(); await renderTasks(); await renderCalendar(); await renderStats(); await renderArchives();};
}

function defaultTask(){
  const d = new Date();
  const today = isoToday();
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
function taskIsUrgent(t){ t=normalizeTask(t); return (t.priority === "urgente" || t.priority === "haute" || t.pinned) && t.status !== "done"; }
function taskIsLate(t){
  t=normalizeTask(t);
  if(!t.end_date || t.status === "done") return false;
  const due = dateObj(t.end_date);
  return due && due < dateObj(isoToday());
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
  const tasks = visibleItems(await loadTasks()).map(normalizeTask);
  const open = tasks.filter(t=>t.status !== 'done');
  const done = tasks.filter(t=>t.status === 'done');
  qs("#tasks").innerHTML=`<div class="glass"><div class="row-flex"><div><h1>Tâches de la semaine</h1><p>Gère les priorités, les dates de mission, les urgences et les tâches épinglées.</p></div><button class="primary-btn" onclick="newTaskForm()">Nouvelle tâche</button></div>
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
  const tasks = visibleItems(await loadTasks()).map(normalizeTask); const openTasks=tasks.filter(t=>t.status!=="done");
  const checks = active.reduce((t,n)=>t+["debtors","profiles","placements","urgent"].reduce((a,k)=>a+(n[k]||[]).filter(i=>i.done).length,0),0);
  const placements = active.reduce((a,n)=>a+(n.placements||[]).filter(p=>p.name||p.client||p.notes).length,0);
  const urgent = active.reduce((a,n)=>a+(n.urgent||[]).filter(u=>u.client||u.request||u.priority).length,0);
  const urgentTasks = openTasks.filter(taskIsUrgent).sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||String(a.end_date).localeCompare(String(b.end_date)));
  const lateTasks = openTasks.filter(taskIsLate);
  const urgentProfiles = active.flatMap(n=>(n.profiles||[]).map(p=>({p:normalizeProfileItem(p),n}))).filter(x=>profileIsUrgent(x.p)||profileIsLate(x.p)||profileStartsToday(x.p));
  qs("#dashboard").innerHTML=`
  <div class="glass"><div class="row-flex"><div><h1>Dashboard Premium</h1><p>Semaine ${weekNumber(new Date())} • ${new Date().getFullYear()}</p></div><div class="note-actions"><button class="primary-btn" onclick="goNew()">Créer une nouvelle note</button><button class="secondary-btn" onclick="openTasksPage()">Voir les tâches</button></div></div>
  <div class="stats-grid"><div class="glass stat-card"><small>Notes actives</small><h2>${active.length}</h2></div><div class="glass stat-card"><small>Tâches ouvertes</small><h2>${openTasks.length}</h2></div><div class="glass stat-card urgent-stat"><small>Tâches urgentes</small><h2>${urgentTasks.length}</h2></div><div class="glass stat-card urgent-stat"><small>Profils urgents</small><h2>${urgentProfiles.length}</h2></div><div class="glass stat-card"><small>Tâches en retard</small><h2>${lateTasks.length}</h2></div><div class="glass stat-card"><small>Tâches complétées notes</small><h2>${checks}</h2></div><div class="glass stat-card"><small>Profils à placer</small><h2>${placements}</h2></div><div class="glass stat-card"><small>Commandes urgentes</small><h2>${urgent}</h2></div></div></div>
  <div class="grid-2"><div class="glass"><h2>Profils urgents / missions</h2>${urgentProfiles.slice(0,8).map(x=>profileCard(x.p,x.n)).join("")||"<div class='empty'>Aucun profil urgent.</div>"}</div><div class="glass"><h2>Tâches urgentes & épinglées</h2>${urgentTasks.slice(0,6).map(taskCard).join("")||"<div class='empty'>Aucune tâche urgente.</div>"}</div></div>
  <div class="grid-2"><div class="glass"><h2>Timeline immédiate</h2>${timelineWidget(openTasks, urgentProfiles)}</div><div class="glass"><h2>Historique récent</h2>${activityFeed(active,tasks).slice(0,7).map(x=>`<div class="activity-row"><b>${esc(x.title)}</b><small>${esc(x.meta)}</small></div>`).join("")||"<div class='empty'>Aucune activité.</div>"}</div></div>
  <div class="glass"><h2>Graphique activité notes</h2>${activityChart(active)}<div class="note-actions" style="margin-top:18px"><button class="secondary-btn" onclick="requestNotify()">Activer notifications</button><button class="secondary-btn" onclick="exportCSV()">Export CSV</button></div></div>`;
  scheduleBrowserReminders(active, openTasks);
}
function noteCardMini(n){ return `<div style="margin-top:16px"><strong>${esc(n.title)}</strong><p>${esc(n.date)} • Semaine ${esc(n.week)}</p><small>${esc((n.summary||"").slice(0,130))}</small></div>`; }
function goNew(){ openViewSafe("newnote"); }
async function openTasksPage(){ await openViewSafe("tasks"); }
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
function tablePlacements(n,r){return `<div class="glass scroll"><h2>Profils à Placer</h2><table><tr><th></th><th>Nom</th><th>Client</th><th>Notes</th></tr>${n.placements.map((p,i)=>`<tr><td><input type="checkbox" data-k="placements" data-i="${i}" ${p.done?"checked":""} ${rowDisabled(r)}></td><td><input class="table-input" id="place-name-${i}" value="${esc(p.name)}" ${rowDisabled(r)}></td><td><input class="table-input" id="place-client-${i}" value="${esc(p.client)}" ${rowDisabled(r)}></td><td><input class="table-input" id="place-notes-${i}" value="${esc(p.notes)}" ${rowDisabled(r)}></td></tr>`).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('placements')">Ajouter ligne</button>`}</div>`}
function tableRdv(n,r){return `<div class="glass scroll"><h2>RDV à Prévoir</h2>${n.rdv.map((x,i)=>`<input id="rdv-${i}" value="${esc(x.text)}" placeholder="RDV ${i+1}" ${rowDisabled(r)}/>`).join("")}${r?"":`<button class="primary-btn" onclick="addRow('rdv')">Ajouter ligne</button>`}</div>`}
function tableUrgent(n,r){return `<div class="glass scroll"><h2>Commandes Urgentes</h2><table><tr><th></th><th>Priorité</th><th>Client</th><th>Demande</th><th>Contact</th><th>Statut</th></tr>${n.urgent.map((u,i)=>`<tr><td><input type="checkbox" data-k="urgent" data-i="${i}" ${u.done?"checked":""} ${rowDisabled(r)}></td><td><input class="table-input" id="urg-priority-${i}" value="${esc(u.priority)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-client-${i}" value="${esc(u.client)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-request-${i}" value="${esc(u.request)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-contact-${i}" value="${esc(u.contact)}" ${rowDisabled(r)}></td><td><input class="table-input" id="urg-status-${i}" value="${esc(u.status)}" ${rowDisabled(r)}></td></tr>`).join("")}</table>${r?"":`<button class="primary-btn" onclick="addRow('urgent')">Ajouter ligne</button>`}</div>`}
function addRow(type){ const rows={debtors:{done:false,client:"",amount:"",action:"",notes:""},profiles:{done:false,text:"",priority:"normale",start_date:"",end_date:"",status:""},placements:{done:false,name:"",client:"",notes:""},urgent:{done:false,priority:"",client:"",request:"",contact:"",status:""},rdv:{text:""}}; currentEditingNote[type].push(rows[type]); renderEditor(currentEditingNote,false); }
function collectNote(){ const n=currentEditingNote; n.title=qs("#title").value; n.sessionDate=qs("#sessionDate")?.value || n.sessionDate || new Date().toISOString().slice(0,10); n.date=new Date(n.sessionDate+"T00:00:00").toLocaleDateString("fr-FR"); n.reminderTime=qs("#reminderTime")?.value || n.reminderTime || "09:00"; n.status=qs("#status")?.value || n.status || "planned"; n.missionStart=qs("#missionStart").value; n.missionEnd=qs("#missionEnd").value; n.summary=qs("#summary").value; n.divers=qs("#divers").value; n.owner_id=n.owner_id||activeUser()?.id||currentProfile?.id; n.user_email=activeUser()?.email||currentProfile?.email||""; qsa("input[type=checkbox][data-k]").forEach(cb=>{n[cb.dataset.k][Number(cb.dataset.i)].done=cb.checked}); n.debtors.forEach((d,i)=>{d.client=qs(`#deb-client-${i}`)?.value||"";d.amount=qs(`#deb-amount-${i}`)?.value||"";d.action=qs(`#deb-action-${i}`)?.value||"";d.notes=qs(`#deb-notes-${i}`)?.value||""}); n.profiles.forEach((p,i)=>{ p=Object.assign(p, normalizeProfileItem(p)); p.text=qs(`#profile-${i}`)?.value||""; p.priority=qs(`#profile-priority-${i}`)?.value||"normale"; p.start_date=qs(`#profile-start-${i}`)?.value||""; p.end_date=qs(`#profile-end-${i}`)?.value||""; p.status=qs(`#profile-status-${i}`)?.value||""; }); n.placements.forEach((p,i)=>{p.name=qs(`#place-name-${i}`)?.value||"";p.client=qs(`#place-client-${i}`)?.value||"";p.notes=qs(`#place-notes-${i}`)?.value||""}); n.rdv.forEach((r,i)=>r.text=qs(`#rdv-${i}`)?.value||""); n.urgent.forEach((u,i)=>{u.priority=qs(`#urg-priority-${i}`)?.value||"";u.client=qs(`#urg-client-${i}`)?.value||"";u.request=qs(`#urg-request-${i}`)?.value||"";u.contact=qs(`#urg-contact-${i}`)?.value||"";u.status=qs(`#urg-status-${i}`)?.value||""}); return n; }
async function saveCurrent(){ try{ const n=collectNote(); await handleFiles(n); await upsertNote(n); currentEditingNote=n; qs("#saveBadge").innerText="Sauvegardé"; toast("Note sauvegardée"); await renderDashboard(); await renderNotes(); await renderArchives(); } catch(e){ toast("Erreur sauvegarde : "+e.message); } }
async function handleFiles(note){ const files=qs("#attachments")?.files || []; if(!files.length) return; for(const file of files){ if(localMode || !supabaseClient){ const data=await fileToDataURL(file); note.attachments.push({name:file.name,type:file.type,url:data,local:true}); } else { const path=`${note.owner_id}/${note.id}/${Date.now()}-${file.name}`; const {error}=await supabaseClient.storage.from(BUCKET).upload(path,file,{upsert:true}); if(error){ note.attachments.push({name:file.name,type:file.type,url:await fileToDataURL(file),local:true}); } else { const {data}=supabaseClient.storage.from(BUCKET).getPublicUrl(path); note.attachments.push({name:file.name,type:file.type,path,url:data.publicUrl}); } } } }
function fileToDataURL(file){ return new Promise(res=>{const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file);}); }
function filePreview(f){ if(typeof f === "string") f={url:f,name:"image"}; const isImg=(f.type||"").startsWith("image") || String(f.url).startsWith("data:image"); return `<div class="file-card">${isImg?`<img src="${esc(f.url)}">`:`<div class="empty">Fichier</div>`}<a href="${esc(f.url)}" target="_blank">${esc(f.name||"Pièce jointe")}</a></div>`; }
async function renderNotes(){ const notes=(await loadNotes()).filter(n=>!n.archived); qs("#notes").innerHTML=`<div class="glass"><div class="row-flex"><h1>Mes Notes</h1><button class="primary-btn" onclick="goNew()">Nouvelle note</button></div>${notes.map(noteCard).join("")||"<div class='empty'>Aucune note.</div>"}</div>`; }
function noteCard(n){ return `<div class="glass"><div class="row-flex"><div><h2>${esc(n.title)}</h2><p>${esc(n.date)} • Semaine ${esc(n.week)} • <span class="pill">${esc(n.user_email||"")}</span></p><small>${esc((n.summary||"").slice(0,150))}</small><p class="muted">Modifié par ${esc(n.modifiedBy||"")} le ${esc(n.modifiedAt||"")}</p></div><div class="note-actions"><button class="primary-btn" onclick="openNote('${n.id}')">Ouvrir</button>${canEdit(n)?`<button class="secondary-btn" onclick="deleteNote('${n.id}')">Supprimer</button>`:""}</div></div></div>`; }
async function openNote(id){ const notes=await loadNotes(); const n=notes.find(x=>String(x.id)===String(id)); qsa(".view").forEach(v=>v.classList.remove("active-view")); qs("#newnote").classList.add("active-view"); renderEditor(n,false); }
async function deleteNote(id){ if(!confirm("Supprimer cette note ?")) return; try{ await removeNote(id); toast("Note supprimée"); await renderNotes(); await renderDashboard(); } catch(e){toast(e.message)} }
async function duplicateNote(id){ const notes=await loadNotes(); const src=notes.find(n=>String(n.id)===String(id)) || currentEditingNote; const copy=normalizeNote(JSON.parse(JSON.stringify(src))); copy.id=uid(); copy.date=todayFr(); copy.week=weekNumber(new Date()); copy.year=new Date().getFullYear(); copy.title=copy.title+" – Copie"; copy.owner_id=activeUser()?.id||currentProfile.id; await upsertNote(copy); toast("Note dupliquée"); await renderNotes(); }
async function toggleArchive(id){ const notes=await loadNotes(); const n=notes.find(x=>String(x.id)===String(id))||currentEditingNote; n.archived=!n.archived; await upsertNote(n); toast(n.archived?"Note archivée":"Note désarchivée"); await renderArchives(); await renderNotes(); }
async function renderArchives(){ const notes=(await loadNotes()).filter(n=>n.archived); const grouped={}; notes.forEach(n=>{grouped[n.year]=grouped[n.year]||{}; grouped[n.year][n.week]=grouped[n.year][n.week]||[]; grouped[n.year][n.week].push(n);}); let html='<div class="glass"><h1>Archives</h1>'; Object.keys(grouped).sort((a,b)=>b-a).forEach(y=>{html+=`<div class="archive-group"><h2>${y}</h2>`; Object.keys(grouped[y]).sort((a,b)=>b-a).forEach(w=>{html+=`<div class="glass"><h3>Semaine ${w}</h3>${grouped[y][w].map(n=>`<p><strong style="cursor:pointer" onclick="openNote('${n.id}')">${esc(n.title)}</strong> - ${esc(n.date)} ${n.archived?"<span class='pill'>Archivée</span>":""}<br><small>${esc((n.summary||"").slice(0,180))}</small></p>`).join("")}</div>`}); html+='</div>';}); qs("#archives").innerHTML=html+'</div>'; }
function renderSearch(){ qs("#search").innerHTML=`<div class="glass"><h1>Recherche globale</h1><input id="searchInput" placeholder="Rechercher contenu, client, semaine, utilisateur..."/><div class="search-results" id="results"></div></div>`; qs("#searchInput").oninput=async e=>{const q=e.target.value.toLowerCase(); const notes=await loadNotes(); const found=q?notes.filter(n=>JSON.stringify(n).toLowerCase().includes(q)):[]; qs("#results").innerHTML=found.map(n=>`<div class="glass" onclick="openNote('${n.id}')"><h3>${esc(n.title)}</h3><p>${esc(n.date)} • Semaine ${esc(n.week)}</p><small>${esc((n.summary||"").slice(0,120))}</small></div>`).join("") || (q?"<div class='empty'>Aucun résultat.</div>":""); }; }
function renderCollaborators(){
  const pending = state.users.filter(u=>u.role !== 'admin');
  const admins = state.users.filter(u=>u.role === 'admin');
  qs("#collaborators").innerHTML=`<div class="glass"><div class="row-flex"><div><h1>Collaborateurs</h1><p>Suivi des utilisateurs, accès admin et comptes en attente de validation.</p></div>${isAdmin()?'<button class="secondary-btn" onclick="renderAdmin(); openView(\'admin\')">Gérer les rôles</button>':''}</div><div class="stats-grid"><div class="glass stat-card"><small>Total utilisateurs</small><h2>${state.users.length}</h2></div><div class="glass stat-card urgent-stat"><small>En attente / non admin</small><h2>${pending.length}</h2></div><div class="glass stat-card"><small>Admins</small><h2>${admins.length}</h2></div></div></div><div class="grid-2"><div class="glass"><h2>Collaborateurs en attente</h2>${pending.map(u=>`<div class="activity-row"><b>${esc(u.full_name||u.email)}</b><small>${esc(u.email||'')} • rôle : ${esc(u.role||'user')}</small></div>`).join('')||"<div class='empty'>Aucun collaborateur en attente.</div>"}</div><div class="glass"><h2>Administrateurs</h2>${admins.map(u=>`<div class="activity-row"><b>${esc(u.full_name||u.email)}</b><small>${esc(u.email||'')}</small></div>`).join('')||"<div class='empty'>Aucun admin listé.</div>"}</div></div>`;
}
function openView(view){ openViewSafe(view); }
function renderSettings(){ qs("#settings").innerHTML=`<div class="glass"><h1>Paramètres</h1><label>Mode</label><select id="themeSel"><option value="dark">Sombre</option><option value="light">Clair</option></select><label style="margin-top:14px"><input type="checkbox" id="notifSel" ${state.settings.notifications?"checked":""}> Notifications navigateur</label><label><input type="checkbox" id="compactSel" ${state.settings.compact?"checked":""}> Affichage compact</label><div class="note-actions" style="margin-top:20px"><button class="primary-btn" onclick="applyTheme()">Appliquer paramètres</button><button class="secondary-btn" onclick="requestNotify()">Autoriser notifications</button><button class="secondary-btn" onclick="exportData()">Exporter JSON</button><button class="secondary-btn" onclick="exportCSV()">Exporter CSV</button><button class="secondary-btn" onclick="importData()">Importer JSON</button><button class="secondary-btn" onclick="resetLocal()">Reset local</button></div><input type="file" id="importFile" style="display:none" accept=".json"/><div class="empty"><b>Supabase :</b> ${supabaseClient?"connecté":"non configuré"}<br><b>Rôle :</b> ${esc(currentProfile?.role||"local")}<br><b>Clé anon :</b> configurée dans config.js</div></div>`; qs("#themeSel").value=state.settings.theme; }
function applyTheme(){ state.settings.theme=qs("#themeSel").value; state.settings.notifications=!!qs("#notifSel")?.checked; state.settings.compact=!!qs("#compactSel")?.checked; document.body.classList.toggle("light",state.settings.theme==="light"); document.body.classList.toggle("compact",state.settings.compact); saveLocal(); toast("Paramètres appliqués"); }
function exportData(){ const blob=new Blob([JSON.stringify({state,currentProfile},null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="seance-hebdomadaire-export.json"; a.click(); }
function importData(){ qs("#importFile").click(); qs("#importFile").onchange=e=>{const file=e.target.files[0]; const r=new FileReader(); r.onload=()=>{const data=JSON.parse(r.result); Object.assign(state,data.state||data); saveLocal(); location.reload();}; r.readAsText(file);}; }
function resetLocal(){ if(confirm("Effacer le cache local ?")){localStorage.removeItem(STORE_KEY); location.reload();} }
async function renderAdmin(){ if(!isAdmin()){qs("#admin").innerHTML="<div class='glass'><h1>Admin</h1><div class='empty'>Accès réservé aux administrateurs.</div></div>"; return;} const notes=await loadNotes(); qs("#admin").innerHTML=`<div class="glass"><h1>Administration</h1><div class="stats-grid"><div class="glass stat-card"><small>Utilisateurs</small><h2>${state.users.length}</h2></div><div class="glass stat-card"><small>Notes visibles</small><h2>${notes.length}</h2></div><div class="glass stat-card"><small>Tâches visibles</small><h2>${(await loadTasks()).length}</h2></div><div class="glass stat-card"><small>Admins</small><h2>${state.users.filter(u=>u.role==="admin").length}</h2></div></div><h2>Utilisateurs</h2><div class="scroll"><table><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Action</th></tr>${state.users.map(u=>`<tr><td>${esc(u.full_name||"")}</td><td>${esc(u.email||"")}</td><td><select id="role-${esc(u.id)}"><option value="user" ${u.role!=="admin"?"selected":""}>user</option><option value="admin" ${u.role==="admin"?"selected":""}>admin</option></select></td><td><button class="secondary-btn" onclick="updateRole('${u.id}')">Enregistrer</button></td></tr>`).join("")}</table></div><h2 style="margin-top:22px">Toutes les notes</h2>${notes.map(noteCard).join("")||"<div class='empty'>Aucune note.</div>"}</div>`; }
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
  const tasks=visibleItems(await loadTasks()).map(normalizeTask);
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
    const key=`${n.id}-${n.sessionDate}-${n.reminderTime}`;
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

/* ==============================
   UPDATE 2026-05-12 - Collaborateurs + dashboard intelligent
   Stockage sans nouvelle table : les collaborateurs sont sauvegardés dans une note système Supabase.
   ============================== */
const COLLAB_SYSTEM_ID = "SYSTEM_COLLABORATORS_V1";
function defaultCollaborator(){
  return {id:String(uid()), owner_id:activeUser()?.id||currentProfile?.id||'local-admin', user_email:activeUser()?.email||currentProfile?.email||'', firstname:'', lastname:'', domain:'Général', available_start:isoToday(), available_end:isoToday(), urgent:false, status:'actif', phone:'', email:'', notes:'', created_at:new Date().toISOString(), updated_at:new Date().toISOString()};
}
function normalizeCollaborator(c){
  return {...defaultCollaborator(), ...(c||{}), id:String(c?.id||uid()), urgent:!!c?.urgent, status:c?.status||'actif'};
}
function collaboratorName(c){ c=normalizeCollaborator(c); return `${c.firstname||''} ${c.lastname||''}`.trim() || c.email || 'Collaborateur sans nom'; }
function collaboratorIsLate(c){ c=normalizeCollaborator(c); return c.status==='actif' && dateObj(c.available_end) && dateObj(c.available_end) < dateObj(isoToday()); }
function collaboratorStartsSoon(c){ c=normalizeCollaborator(c); const d=dateObj(c.available_start); if(!d || c.status!=='actif') return false; const diff=daysBetween(new Date(), d); return diff>=0 && diff<=3; }
async function loadCollaborators(){
  if(!state.collaborators) state.collaborators=[];
  if(localMode || !supabaseClient) return state.collaborators.map(normalizeCollaborator);
  try{
    const owner = isAdmin() && state.currentUserId && state.currentUserId!=='all' ? state.currentUserId : currentProfile.id;
    const {data,error}=await supabaseClient.from('weekly_notes').select('*').eq('id', `${COLLAB_SYSTEM_ID}_${owner}`).maybeSingle();
    if(error || !data) return state.collaborators.map(normalizeCollaborator);
    const parsed = JSON.parse(data.summary || '[]');
    return (Array.isArray(parsed)?parsed:[]).map(normalizeCollaborator);
  }catch(e){ console.warn('Collaborateurs fallback local', e); return state.collaborators.map(normalizeCollaborator); }
}
async function saveCollaborators(list){
  state.collaborators = (list||[]).map(normalizeCollaborator); saveLocal();
  if(localMode || !supabaseClient) return;
  const owner = currentProfile.id;
  const sys={ id:`${COLLAB_SYSTEM_ID}_${owner}`, owner_id:owner, user_email:currentProfile.email, title:'__SYSTEM_COLLABORATORS__', date:todayFr(), week:weekNumber(new Date()), year:new Date().getFullYear(), missionStart:'', missionEnd:'', debtors:[], profiles:[], placements:[], rdv:[], urgent:[], divers:'Données techniques collaborateurs', attachments:[], summary:JSON.stringify(state.collaborators), archived:true, modifiedBy:currentProfile.full_name||currentProfile.email, modifiedAt:nowFr(), created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
  await upsertNote(sys);
}
function collaboratorCard(c){
  c=normalizeCollaborator(c);
  const urgentClass = c.urgent ? 'priority-urgent' : collaboratorIsLate(c) ? 'priority-high' : 'priority-mid';
  return `<div class="profile-alert-card ${collaboratorIsLate(c)?'task-late':''}"><div><span class="task-priority ${urgentClass}">${c.urgent?'Urgent':collaboratorIsLate(c)?'Fin dépassée':'Normal'}</span><h3>${esc(collaboratorName(c))}</h3><p>${esc(c.domain)} • ${esc(c.status)}${c.phone?' • '+esc(c.phone):''}${c.email?' • '+esc(c.email):''}</p><small>Disponible du ${dateFr(c.available_start)} au ${dateFr(c.available_end)} • ${countdownLabel(c.available_end)}</small>${c.notes?`<small>${esc(c.notes)}</small>`:''}</div><div class="note-actions"><button class="secondary-btn" onclick="editCollaborator('${c.id}')">Modifier</button><button class="secondary-btn danger" onclick="deleteCollaborator('${c.id}')">Supprimer</button></div></div>`;
}
async function renderCollaborators(){
  const list=(await loadCollaborators()).map(normalizeCollaborator);
  const active=list.filter(c=>c.status==='actif');
  const urgent=active.filter(c=>c.urgent || collaboratorIsLate(c));
  const soon=active.filter(collaboratorStartsSoon);
  const domains=[...new Set(list.map(c=>c.domain||'Général'))];
  qs('#collaborators').innerHTML=`<div class="glass"><div class="row-flex"><div><h1>Collaborateurs</h1><p>Inscris les disponibilités, domaines, urgences et informations utiles sans rien relier de plus.</p></div><button class="primary-btn" onclick="newCollaboratorForm()">Ajouter collaborateur</button></div><div class="stats-grid"><div class="glass stat-card"><small>Total</small><h2>${list.length}</h2></div><div class="glass stat-card"><small>Actifs</small><h2>${active.length}</h2></div><div class="glass stat-card urgent-stat"><small>Urgents / dépassés</small><h2>${urgent.length}</h2></div><div class="glass stat-card"><small>Démarrent bientôt</small><h2>${soon.length}</h2></div><div class="glass stat-card"><small>Domaines</small><h2>${domains.length}</h2></div></div><div id="collabFormArea"></div></div><div class="glass"><h2>Liste collaborateurs</h2><div class="toolbar"><input id="collabSearch" oninput="filterCollaborators()" placeholder="Rechercher nom, domaine, note..."><select id="collabFilter" onchange="filterCollaborators()"><option value="all">Tous</option><option value="urgent">Urgents</option><option value="late">Fin dépassée</option><option value="soon">Début bientôt</option><option value="actif">Actifs</option><option value="inactif">Inactifs</option></select></div><div id="collabList">${list.map(collaboratorCard).join('')||"<div class='empty'>Aucun collaborateur inscrit.</div>"}</div></div>`;
}
function collaboratorForm(c=defaultCollaborator()){
  c=normalizeCollaborator(c);
  return `<div class="glass task-form"><h2>${c.firstname||c.lastname?'Modifier collaborateur':'Nouveau collaborateur'}</h2><div class="grid-3"><div><label>Prénom</label><input id="collabFirstname" value="${esc(c.firstname)}"></div><div><label>Nom</label><input id="collabLastname" value="${esc(c.lastname)}"></div><div><label>Domaine</label><input id="collabDomain" value="${esc(c.domain)}" placeholder="Électricité, admin, vente..."></div></div><div class="grid-3"><div><label>Début disponibilité</label><input id="collabStart" type="date" value="${esc(c.available_start)}"></div><div><label>Fin disponibilité</label><input id="collabEnd" type="date" value="${esc(c.available_end)}"></div><div><label>Statut</label><select id="collabStatus"><option value="actif">Actif</option><option value="inactif">Inactif</option><option value="en attente">En attente</option></select></div></div><div class="grid-3"><div><label>Téléphone</label><input id="collabPhone" value="${esc(c.phone)}"></div><div><label>Email</label><input id="collabEmail" value="${esc(c.email)}"></div><label class="checkline"><input id="collabUrgent" type="checkbox" ${c.urgent?'checked':''}> Urgence</label></div><label>Notes</label><textarea id="collabNotes" placeholder="Disponibilité spéciale, préférences, détails...">${esc(c.notes)}</textarea><div class="note-actions"><button class="primary-btn" onclick="saveCollaborator('${c.id}')">Sauvegarder</button><button class="secondary-btn" onclick="renderCollaborators()">Annuler</button></div></div>`;
}
function newCollaboratorForm(){ qs('#collabFormArea').innerHTML=collaboratorForm(defaultCollaborator()); qs('#collabStatus').value='actif'; }
async function editCollaborator(id){ const list=await loadCollaborators(); const c=list.find(x=>String(x.id)===String(id)); qs('#collabFormArea').innerHTML=collaboratorForm(c||defaultCollaborator()); qs('#collabStatus').value=(c||{}).status||'actif'; qs('#collabFormArea').scrollIntoView({behavior:'smooth',block:'start'}); }
async function saveCollaborator(id){
  const list=await loadCollaborators(); let c=list.find(x=>String(x.id)===String(id)) || defaultCollaborator();
  c={...c, firstname:qs('#collabFirstname').value.trim(), lastname:qs('#collabLastname').value.trim(), domain:qs('#collabDomain').value.trim()||'Général', available_start:qs('#collabStart').value||isoToday(), available_end:qs('#collabEnd').value||qs('#collabStart').value||isoToday(), status:qs('#collabStatus').value, phone:qs('#collabPhone').value.trim(), email:qs('#collabEmail').value.trim(), urgent:!!qs('#collabUrgent').checked, notes:qs('#collabNotes').value.trim(), updated_at:new Date().toISOString()};
  if(!c.firstname && !c.lastname && !c.email) return toast('Ajoute au moins un nom, prénom ou email.');
  const i=list.findIndex(x=>String(x.id)===String(c.id)); if(i>=0) list[i]=c; else list.unshift(c);
  await saveCollaborators(list); toast('Collaborateur sauvegardé'); await renderCollaborators(); await renderDashboard(); await renderStats();
}
async function deleteCollaborator(id){ if(!confirm('Supprimer ce collaborateur ?')) return; const list=(await loadCollaborators()).filter(c=>String(c.id)!==String(id)); await saveCollaborators(list); toast('Collaborateur supprimé'); await renderCollaborators(); await renderDashboard(); }
async function filterCollaborators(){
  const q=(qs('#collabSearch')?.value||'').toLowerCase(); const f=qs('#collabFilter')?.value||'all'; let list=await loadCollaborators();
  list=list.filter(c=>{c=normalizeCollaborator(c); const okQ=!q || JSON.stringify(c).toLowerCase().includes(q); const okF=f==='all'||(f==='urgent'&&c.urgent)||(f==='late'&&collaboratorIsLate(c))||(f==='soon'&&collaboratorStartsSoon(c))||(f==='actif'&&c.status==='actif')||(f==='inactif'&&c.status==='inactif'); return okQ&&okF;});
  qs('#collabList').innerHTML=list.map(collaboratorCard).join('') || "<div class='empty'>Aucun collaborateur trouvé.</div>";
}
function collaboratorTimeline(list){
  const rows=list.filter(c=>c.status==='actif'&&(c.urgent||collaboratorIsLate(c)||collaboratorStartsSoon(c))).slice(0,8);
  return rows.map(c=>`<div class="timeline-row ${c.urgent||collaboratorIsLate(c)?'urgent-line':''}"><span>${c.urgent?'Urgent':'Dispo'}</span><div><b>${esc(collaboratorName(c))}</b><small>${esc(c.domain)} • ${dateFr(c.available_start)} → ${dateFr(c.available_end)} • ${countdownLabel(c.available_end)}</small></div></div>`).join('') || "<div class='empty'>Aucun collaborateur urgent.</div>";
}
async function renderDashboard(){
  const notes = visibleNotes(await loadNotes()).filter(n=>!String(n.id).startsWith(COLLAB_SYSTEM_ID)); const active=notes.filter(n=>!n.archived);
  const tasks = visibleItems(await loadTasks()).map(normalizeTask); const openTasks=tasks.filter(t=>t.status!=="done");
  const collaborators=(await loadCollaborators()).map(normalizeCollaborator); const activeCollab=collaborators.filter(c=>c.status==='actif'); const urgentCollab=activeCollab.filter(c=>c.urgent||collaboratorIsLate(c));
  const checks = active.reduce((t,n)=>t+["debtors","profiles","placements","urgent"].reduce((a,k)=>a+(n[k]||[]).filter(i=>i.done).length,0),0);
  const urgentTasks = openTasks.filter(taskIsUrgent).sort((a,b)=>(Number(b.pinned)-Number(a.pinned))||String(a.end_date).localeCompare(String(b.end_date)));
  const lateTasks = openTasks.filter(taskIsLate);
  const urgentProfiles = active.flatMap(n=>(n.profiles||[]).map(p=>({p:normalizeProfileItem(p),n}))).filter(x=>profileIsUrgent(x.p)||profileIsLate(x.p)||profileStartsToday(x.p));
  qs('#dashboard').innerHTML=`<div class="glass"><div class="row-flex"><div><h1>Dashboard Premium</h1><p>Semaine ${weekNumber(new Date())} • centre de contrôle notes, tâches et collaborateurs</p></div><div class="note-actions"><button class="primary-btn" onclick="goNew()">Créer une nouvelle note</button><button class="secondary-btn" onclick="openViewSafe('collaborators')">Collaborateurs</button><button class="secondary-btn" onclick="openTasksPage()">Tâches</button></div></div><div class="stats-grid"><div class="glass stat-card"><small>Notes actives</small><h2>${active.length}</h2></div><div class="glass stat-card"><small>Tâches ouvertes</small><h2>${openTasks.length}</h2></div><div class="glass stat-card urgent-stat"><small>Tâches urgentes</small><h2>${urgentTasks.length}</h2></div><div class="glass stat-card urgent-stat"><small>Collaborateurs urgents</small><h2>${urgentCollab.length}</h2></div><div class="glass stat-card"><small>Collaborateurs actifs</small><h2>${activeCollab.length}</h2></div><div class="glass stat-card"><small>Tâches en retard</small><h2>${lateTasks.length}</h2></div><div class="glass stat-card"><small>Profils urgents notes</small><h2>${urgentProfiles.length}</h2></div><div class="glass stat-card"><small>Actions cochées</small><h2>${checks}</h2></div></div></div><div class="grid-2"><div class="glass"><h2>Collaborateurs à suivre</h2>${collaboratorTimeline(activeCollab)}</div><div class="glass"><h2>Tâches urgentes & épinglées</h2>${urgentTasks.slice(0,6).map(taskCard).join('')||"<div class='empty'>Aucune tâche urgente.</div>"}</div></div><div class="grid-2"><div class="glass"><h2>Profils urgents / missions</h2>${urgentProfiles.slice(0,8).map(x=>profileCard(x.p,x.n)).join('')||"<div class='empty'>Aucun profil urgent.</div>"}</div><div class="glass"><h2>Historique récent</h2>${activityFeed(active,tasks).slice(0,7).map(x=>`<div class="activity-row"><b>${esc(x.title)}</b><small>${esc(x.meta)}</small></div>`).join('')||"<div class='empty'>Aucune activité.</div>"}</div></div><div class="glass"><h2>Graphique activité notes</h2>${activityChart(active)}<div class="note-actions" style="margin-top:18px"><button class="secondary-btn" onclick="requestNotify()">Activer notifications</button><button class="secondary-btn" onclick="exportCSV()">Export CSV</button></div></div>`;
  scheduleBrowserReminders(active, openTasks);
}
async function renderStats(){
  const notes=visibleNotes(await loadNotes()).filter(n=>!String(n.id).startsWith(COLLAB_SYSTEM_ID)); const tasks=visibleItems(await loadTasks()).map(normalizeTask); const collaborators=(await loadCollaborators()).map(normalizeCollaborator);
  const active=notes.filter(n=>!n.archived); const done=active.filter(n=>n.status==='done').length; const planned=active.filter(n=>n.status!=='done').length; const avg=active.length?Math.round(active.reduce((a,n)=>a+noteScore(n),0)/active.length):0;
  const taskOpen=tasks.filter(t=>t.status!=='done'); const taskDone=tasks.filter(t=>t.status==='done').length; const urgentCollab=collaborators.filter(c=>c.status==='actif'&&(c.urgent||collaboratorIsLate(c)));
  const cat={}; taskOpen.forEach(t=>cat[t.category||'Général']=(cat[t.category||'Général']||0)+1); const domains={}; collaborators.forEach(c=>domains[c.domain||'Général']=(domains[c.domain||'Général']||0)+1);
  qs('#stats').innerHTML=`<div class="glass"><h1>Centre statistiques premium</h1><div class="stats-grid"><div class="glass stat-card"><small>Séances terminées</small><h2>${done}</h2></div><div class="glass stat-card"><small>Séances à suivre</small><h2>${planned}</h2></div><div class="glass stat-card"><small>Progression moyenne</small><h2>${avg}%</h2></div><div class="glass stat-card"><small>Tâches ouvertes</small><h2>${taskOpen.length}</h2></div><div class="glass stat-card urgent-stat"><small>Tâches urgentes</small><h2>${taskOpen.filter(taskIsUrgent).length}</h2></div><div class="glass stat-card"><small>Collaborateurs</small><h2>${collaborators.length}</h2></div><div class="glass stat-card urgent-stat"><small>Collab. urgents</small><h2>${urgentCollab.length}</h2></div><div class="glass stat-card"><small>Tâches terminées</small><h2>${taskDone}</h2></div></div></div><div class="grid-2"><div class="glass"><h2>Activité tâches sur 7 jours</h2>${taskActivityChart(tasks)}</div><div class="glass"><h2>Répartition tâches</h2>${donutChart([{label:'Ouvertes',value:taskOpen.length,color:'#22d3ee'},{label:'Terminées',value:taskDone,color:'#9cffc0'},{label:'Urgentes',value:taskOpen.filter(taskIsUrgent).length,color:'#fb7185'}])}</div></div><div class="grid-2"><div class="glass"><h2>Tâches par catégorie</h2>${Object.entries(cat).map(([k,c])=>`<div class="progress-row"><span>${esc(k)}</span><div class="progress"><i style="width:${Math.min(100,c/Math.max(1,...Object.values(cat))*100)}%"></i></div><b>${c}</b></div>`).join('')||"<div class='empty'>Aucune tâche ouverte.</div>"}</div><div class="glass"><h2>Collaborateurs par domaine</h2>${Object.entries(domains).map(([k,c])=>`<div class="progress-row"><span>${esc(k)}</span><div class="progress"><i style="width:${Math.min(100,c/Math.max(1,...Object.values(domains))*100)}%"></i></div><b>${c}</b></div>`).join('')||"<div class='empty'>Aucun collaborateur.</div>"}</div></div><div class="glass"><h2>Progression par note</h2>${active.slice(0,12).map(n=>`<div class="progress-row"><span>${esc(n.title).slice(0,36)}</span><div class="progress"><i style="width:${noteScore(n)}%"></i></div><b>${noteScore(n)}%</b></div>`).join('')||"<div class='empty'>Aucune donnée.</div>"}</div>`;
}

/* Masquage des notes système dans les onglets utilisateur */
async function renderNotes(){ const notes=(await loadNotes()).filter(n=>!n.archived && !String(n.id).startsWith(COLLAB_SYSTEM_ID)); qs('#notes').innerHTML=`<div class="glass"><div class="row-flex"><h1>Mes Notes</h1><button class="primary-btn" onclick="goNew()">Nouvelle note</button></div>${notes.map(noteCard).join('')||"<div class='empty'>Aucune note.</div>"}</div>`; }
async function renderArchives(){ const notes=(await loadNotes()).filter(n=>n.archived && !String(n.id).startsWith(COLLAB_SYSTEM_ID)); const grouped={}; notes.forEach(n=>{grouped[n.year]=grouped[n.year]||{}; grouped[n.year][n.week]=grouped[n.year][n.week]||[]; grouped[n.year][n.week].push(n);}); let html='<div class="glass"><h1>Archives</h1>'; Object.keys(grouped).sort((a,b)=>b-a).forEach(y=>{html+=`<div class="archive-group"><h2>${y}</h2>`; Object.keys(grouped[y]).sort((a,b)=>b-a).forEach(w=>{html+=`<div class="glass"><h3>Semaine ${w}</h3>${grouped[y][w].map(n=>`<p><strong style="cursor:pointer" onclick="openNote('${n.id}')">${esc(n.title)}</strong> - ${esc(n.date)} ${n.archived?"<span class='pill'>Archivée</span>":""}<br><small>${esc((n.summary||'').slice(0,180))}</small></p>`).join('')}</div>`}); html+='</div>';}); qs('#archives').innerHTML=html+(notes.length?'':"<div class='empty'>Aucune archive.</div>")+'</div>'; }
function renderSearch(){ qs('#search').innerHTML=`<div class="glass"><h1>Recherche globale</h1><p>Recherche dans les notes, tâches et collaborateurs.</p><input id="searchInput" placeholder="Rechercher contenu, client, collaborateur, domaine, semaine..."/><div class="search-results" id="results"></div></div>`; qs('#searchInput').oninput=async e=>{const q=e.target.value.toLowerCase(); const notes=(await loadNotes()).filter(n=>!String(n.id).startsWith(COLLAB_SYSTEM_ID)); const tasks=await loadTasks(); const collabs=await loadCollaborators(); const foundNotes=q?notes.filter(n=>JSON.stringify(n).toLowerCase().includes(q)):[]; const foundTasks=q?tasks.filter(t=>JSON.stringify(t).toLowerCase().includes(q)):[]; const foundCollabs=q?collabs.filter(c=>JSON.stringify(c).toLowerCase().includes(q)):[]; qs('#results').innerHTML=q?`${foundNotes.map(n=>`<div class="glass" onclick="openNote('${n.id}')"><span class="pill">Note</span><h3>${esc(n.title)}</h3><p>${esc(n.date)} • Semaine ${esc(n.week)}</p><small>${esc((n.summary||'').slice(0,120))}</small></div>`).join('')}${foundTasks.map(t=>`<div class="glass" onclick="openViewSafe('tasks')"><span class="pill">Tâche</span><h3>${esc(t.title)}</h3><p>${esc(t.category||'Général')} • ${esc(t.priority||'')}</p></div>`).join('')}${foundCollabs.map(c=>`<div class="glass" onclick="openViewSafe('collaborators')"><span class="pill">Collaborateur</span><h3>${esc(collaboratorName(c))}</h3><p>${esc(c.domain)} • ${dateFr(c.available_start)} → ${dateFr(c.available_end)}</p></div>`).join('')}`||"<div class='empty'>Aucun résultat.</div>":''; }; }
async function exportCSV(){ const notes=(await loadNotes()).filter(n=>!String(n.id).startsWith(COLLAB_SYSTEM_ID)); const rows=[["titre","date_seance","semaine","annee","email","statut","progression","resume"]].concat(notes.map(n=>[n.title,n.sessionDate||n.date,n.week,n.year,n.user_email,n.status||'',noteScore(n),(n.summary||'').replace(/\n/g,' ')])); const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='seances-export.csv'; a.click(); }
