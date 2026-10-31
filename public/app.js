(() => {
  const $=id=>document.getElementById(id);
  const screens=["welcomeScreen","authScreen","chatScreen"];
  let supabaseClient,session,currentConversation=null,conversations=[],authMode="login",pendingFiles=[],recognition=null;
  const show=id=>{screens.forEach(s=>$(s).classList.toggle("hidden",s!==id));$("sidebar")?.classList.remove("open");};
  function addMessage(text,role="assistant",files=[]){
    $("chatWelcome").classList.add("hidden");
    const wrap=document.createElement("article");wrap.className=`message ${role}`;
    const avatar=document.createElement("div");avatar.className="message-avatar";avatar.textContent=role==="assistant"?"S":"Y";
    const body=document.createElement("div");body.className="message-body";
    const content=document.createElement("div");content.className="message-content";content.textContent=text;body.appendChild(content);
    files.forEach(file=>{
      if(file.type?.startsWith("image/")){const img=document.createElement("img");img.className="generated-image";img.src=URL.createObjectURL(file);img.alt=file.name;body.appendChild(img);}
      else {const tag=document.createElement("div");tag.className="file-chip";tag.textContent=`📎 ${file.name} (local preview only)`;body.appendChild(tag);}
    });
    wrap.append(avatar,body);$("messages").appendChild(wrap);$("messages").scrollTop=$("messages").scrollHeight;return wrap;
  }
  async function init(){
    try{
      const config=await (await fetch("/api/config")).json();
      if(!config.supabaseUrl||!config.supabaseAnonKey||!window.supabase)throw new Error("Supabase configuration is missing.");
      supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
      const {data}=await supabaseClient.auth.getSession();session=data.session;
      if(session)await enterApp();else show("welcomeScreen");
    }catch(e){console.error(e);show("welcomeScreen");}
    finally{$("bootScreen").classList.add("hidden");}
  }
  async function enterApp(){show("chatScreen");$("userEmail").textContent=session.user.email||"Signed in";await loadConversations();if(!currentConversation)await createConversation();}
  async function loadConversations(){
    const {data,error}=await supabaseClient.from("conversations").select("*").order("updated_at",{ascending:false}).limit(60);
    if(error){console.error(error);$("chatHistory").textContent="Couldn't load chats. Check database permissions.";return;}
    conversations=data||[];renderHistory();
  }
  function renderHistory(){
    const list=$("chatHistory");list.replaceChildren();
    conversations.forEach(c=>{const b=document.createElement("button");b.className="history-item"+(c.id===currentConversation?" selected":"");b.textContent=c.title||"New conversation";b.onclick=()=>openConversation(c.id);list.appendChild(b);});
  }
  async function createConversation(){
    const {data,error}=await supabaseClient.from("conversations").insert({user_id:session.user.id,title:"New conversation"}).select().single();
    if(error){addMessage(`I couldn't create a chat: ${error.message}`);return;}
    conversations.unshift(data);currentConversation=data.id;renderHistory();$("messages").replaceChildren($("chatWelcome"));$("chatWelcome").classList.remove("hidden");
  }
  async function openConversation(id){
    currentConversation=id;renderHistory();
    const {data,error}=await supabaseClient.from("messages").select("*").eq("conversation_id",id).order("created_at",{ascending:true});
    if(error){addMessage(`Couldn't load this chat: ${error.message}`);return;}
    $("messages").replaceChildren();
    if(!data?.length){$("messages").appendChild($("chatWelcome"));$("chatWelcome").classList.remove("hidden");}
    else data.forEach(m=>addMessage(m.content,m.role));
  }
  async function save(role,content){
    const {error}=await supabaseClient.from("messages").insert({conversation_id:currentConversation,user_id:session.user.id,role,content});
    if(error)throw error;
    await supabaseClient.from("conversations").update({updated_at:new Date().toISOString()}).eq("id",currentConversation);
  }
  async function send(){
    const text=$("prompt").value.trim();if(!text&&!pendingFiles.length)return;
    if(!currentConversation)await createConversation();
    const files=[...pendingFiles];pendingFiles=[];renderFiles();
    const userText=text||"Attached file(s) selected for later analysis.";
    addMessage(userText,"user",files);$("prompt").value="";resize();
    try{
      await save("user",userText);
      const reply="Thanks — your message has been saved in your Sky chat history. 💙 AI replies, web search, image generation, and file analysis are temporarily disabled so Sky does not use paid API services. You can still organize your chats and use your browser's built-in voice input. We'll activate the AI tools when you're ready.";
      addMessage(reply);await save("assistant",reply);
      const convo=conversations.find(c=>c.id===currentConversation);
      if(convo?.title==="New conversation")await supabaseClient.from("conversations").update({title:userText.slice(0,42),updated_at:new Date().toISOString()}).eq("id",currentConversation);
      await loadConversations();
    }catch(e){addMessage(`Couldn't save this message: ${e.message}`);}
  }
  function renderFiles(){
    const box=$("attachmentPreview");box.replaceChildren();
    pendingFiles.forEach((f,i)=>{const chip=document.createElement("span");chip.className="file-chip";chip.textContent=f.name+" ";
      const x=document.createElement("button");x.textContent="×";x.onclick=()=>{pendingFiles.splice(i,1);renderFiles();};chip.appendChild(x);box.appendChild(chip);});
  }
  function resize(){const p=$("prompt");p.style.height="auto";p.style.height=Math.min(p.scrollHeight,150)+"px";}
  function voice(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){addMessage("Voice typing isn't supported in this browser. You can still type your message.");return;}
    if(recognition){recognition.stop();recognition=null;$("voiceButton").classList.remove("recording");return;}
    recognition=new SR();recognition.lang="en-US";recognition.interimResults=true;$("voiceButton").classList.add("recording");
    recognition.onresult=e=>{let t="";for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;$("prompt").value=t;resize();};
    recognition.onerror=()=>{$("voiceButton").classList.remove("recording");recognition=null;};
    recognition.onend=()=>{$("voiceButton").classList.remove("recording");recognition=null;};recognition.start();
  }
  $("year").textContent=new Date().getFullYear();
  $("loginNav").onclick=$("welcomeLoginButton").onclick=()=>setAuth("login");
  $("signupNav").onclick=$("getStartedButton").onclick=()=>setAuth("signup");
  $("backHomeButton").onclick=()=>show("welcomeScreen");
  function setAuth(mode){
    authMode=mode;$("authTitle").textContent=mode==="login"?"Welcome back":"Create your Sky account";
    $("authDescription").textContent=mode==="login"?"Sign in to continue your conversations.":"Create an account to start using Sky.";
    $("authSubmit").textContent=mode==="login"?"Log in":"Create account";$("authSwitchText").textContent=mode==="login"?"New to Sky?":"Already have an account?";
    $("authSwitchButton").textContent=mode==="login"?"Create an account":"Log in";$("authPassword").autocomplete=mode==="login"?"current-password":"new-password";$("authMessage").textContent="";show("authScreen");
  }
  $("authSwitchButton").onclick=()=>setAuth(authMode==="login"?"signup":"login");
  $("authForm").onsubmit=async e=>{
    e.preventDefault();$("authSubmit").disabled=true;$("authMessage").textContent="Please wait…";
    const email=$("authEmail").value.trim(),password=$("authPassword").value;
    const result=authMode==="signup"?await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:location.origin}}):await supabaseClient.auth.signInWithPassword({email,password});
    $("authSubmit").disabled=false;if(result.error){$("authMessage").textContent=result.error.message;return;}
    if(authMode==="signup"&&!result.data.session){$("authMessage").textContent="Check your email to confirm your account, then log in.";return;}
    session=result.data.session;await enterApp();
  };
  $("logoutButton").onclick=async()=>{await supabaseClient.auth.signOut();session=null;currentConversation=null;show("welcomeScreen");};
  $("newChatButton").onclick=createConversation;
  $("chatForm").onsubmit=e=>{e.preventDefault();send();};
  $("prompt").addEventListener("input",resize);
  $("prompt").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}});
  $("attachButton").onclick=()=>$("fileInput").click();
  $("fileInput").onchange=e=>{pendingFiles=[...pendingFiles,...Array.from(e.target.files)].slice(0,5);renderFiles();e.target.value="";};
  $("voiceButton").onclick=voice;
  $("openSidebar").onclick=()=>$("sidebar").classList.add("open");
  $("closeSidebar").onclick=()=>$("sidebar").classList.remove("open");
  document.querySelectorAll(".suggestion").forEach(b=>b.onclick=()=>{$("prompt").value=b.dataset.prompt;send();});
  init();
})();