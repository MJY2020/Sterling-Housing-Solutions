const express=require("express");
const session=require("express-session");
const nodemailer=require("nodemailer");
const fs=require("fs");
const path=require("path");

const app=express();
const PORT=process.env.PORT||3000;
const CONFIG=path.join(__dirname,"config.json");
const ENQUIRIES=process.env.ENQUIRIES_PATH||path.join(__dirname,"enquiries.json");
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
const DEFAULT_WHATSAPP_MESSAGE="Hi Sterling Housing Solutions, I need help with a damp or mould issue.";
const IS_PRODUCTION=process.env.NODE_ENV==="production";
const ALLOW_CONFIG_SECRETS=!IS_PRODUCTION||process.env.ALLOW_ADMIN_SECRET_STORAGE==="true";
const MAX_FIELD_LENGTH=4000;
const VALID_STATUSES=new Set(["new","contacted","call_back","in_progress","done"]);

if(!ADMIN_PASSWORD){
  console.error("ADMIN_PASSWORD environment variable is required.");
  process.exit(1);
}
if(IS_PRODUCTION&&!process.env.SESSION_SECRET){
  console.error("SESSION_SECRET environment variable is required in production.");
  process.exit(1);
}

function readConfig(){
  try{return JSON.parse(fs.readFileSync(CONFIG,"utf8"))}
  catch{return {enquiryEmail:"",whatsappNumber:"",whatsappMessage:DEFAULT_WHATSAPP_MESSAGE}}
}
function effectiveConfig(){
  const c=readConfig();
  return {
    ...c,
    enquiryEmail:process.env.ENQUIRY_EMAIL||c.enquiryEmail||"",
    whatsappNumber:process.env.WHATSAPP_NUMBER||c.whatsappNumber||"",
    whatsappMessage:process.env.WHATSAPP_MESSAGE||c.whatsappMessage||DEFAULT_WHATSAPP_MESSAGE,
    emailDelivery:process.env.EMAIL_DELIVERY||c.emailDelivery||"resend",
    web3formsAccessKey:process.env.WEB3FORMS_ACCESS_KEY||c.web3formsAccessKey||"",
    resendFrom:process.env.RESEND_FROM||c.resendFrom||"Sterling Housing Solutions <onboarding@resend.dev>"
  };
}
function writeConfig(c){fs.writeFileSync(CONFIG,JSON.stringify(c,null,2))}
function readEnquiries(){
  try{
    const data=JSON.parse(fs.readFileSync(ENQUIRIES,"utf8"));
    return Array.isArray(data)?data:[];
  }catch{return []}
}
function writeEnquiries(items){fs.writeFileSync(ENQUIRIES,JSON.stringify(items,null,2))}
function clientIp(req){return req.ip||req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown"}
function rateLimit({windowMs,max,name}){
  const hits=new Map();
  return (req,res,next)=>{
    const now=Date.now();
    const key=`${name}:${clientIp(req)}`;
    const item=hits.get(key);
    if(!item||item.resetAt<now){
      hits.set(key,{count:1,resetAt:now+windowMs});
      return next();
    }
    item.count+=1;
    if(item.count>max) return res.status(429).json({error:"Too many attempts. Please try again later."});
    next();
  };
}
function cleanText(value,max=MAX_FIELD_LENGTH){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max)}
function isEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim())}
function sanitizeFields(fields){
  const out={};
  if(!fields||typeof fields!=="object") return out;
  for(const [key,value] of Object.entries(fields)){
    const safeKey=cleanText(key,80);
    if(!safeKey) continue;
    out[safeKey]=cleanText(value);
  }
  return out;
}
function validateEnquiry(data,fields){
  if(cleanText(data.website,200)) return "Unable to submit enquiry.";
  if(!["landlord","council","tenant","website"].includes(cleanText(data.userType,40))) return "Please choose the enquiry type.";
  if(!cleanText(fields["Property address"],300)) return "Please enter the property address.";
  if(!cleanText(fields["Describe the damp or mould"],1200)) return "Please describe the damp or mould issue.";
  if(!cleanText(fields["Full name"],160)) return "Please enter your full name.";
  if(!isEmail(fields.Email)) return "Please enter a valid email address.";
  const consent=Object.entries(fields).some(([key,value])=>key.startsWith("I agree to be contacted about this enquiry")&&value==="Yes");
  if(!consent) return "Please confirm you agree to be contacted about this enquiry.";
  return "";
}
function smtpConfig(c){
  const port=Number(process.env.SMTP_PORT||c.smtpPort||587);
  return {
    host:process.env.SMTP_HOST||c.smtpHost||"",
    port,
    secure:port===465||String(process.env.SMTP_SECURE??c.smtpSecure??"false")==="true",
    user:process.env.SMTP_USER||c.smtpUser||"",
    pass:process.env.SMTP_PASS||c.smtpPass||"",
    from:process.env.SMTP_FROM||c.smtpFrom||process.env.SMTP_USER||c.smtpUser||""
  };
}
function resendConfig(c){
  return {
    apiKey:process.env.RESEND_API_KEY||c.resendApiKey||"",
    from:process.env.RESEND_FROM||c.resendFrom||"Sterling Housing Solutions <onboarding@resend.dev>"
  };
}
function enquiryEmailText(record){
  const rows=Object.entries(record.fields||{}).map(([k,v])=>`${k}: ${String(v)}`).join("\n");
  return `New Sterling Housing Solutions enquiry

Reference: ${record.id}
User type: ${record.userType||""}
Housing/landlord type: ${record.managerType||""}
Submitted: ${record.submittedAt||new Date().toISOString()}
Page: ${record.page||""}

${rows}`;
}
function enquirySummary(fields){
  return fields["Describe the damp or mould"]||fields["Property address"]||fields["Rooms affected"]||"Website enquiry";
}
async function sendMailWithConfig(c,{to,subject,text}){
  const smtp=smtpConfig(c);
  if(!smtp.host||!smtp.user||!smtp.pass) throw new Error("Email service has not been configured yet.");
  if(!to) throw new Error("Recipient email has not been configured yet.");
  const transport=nodemailer.createTransport({
    host:smtp.host,
    port:Number(smtp.port||587),
    secure:smtp.secure,
    auth:{user:smtp.user,pass:smtp.pass},
    connectionTimeout:10000,
    greetingTimeout:10000,
    socketTimeout:15000
  });
  await transport.sendMail({
    from:smtp.from||smtp.user,
    to,
    subject,
    text
  });
}
async function sendResendWithConfig(c,{to,subject,text}){
  const resend=resendConfig(c);
  if(!resend.apiKey) throw new Error("Resend API key has not been configured yet.");
  if(!to) throw new Error("Recipient email has not been configured yet.");
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${resend.apiKey}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      from:resend.from,
      to:[to],
      subject,
      text
    })
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body.message||body.error||`Resend email failed with status ${response.status}`);
  return body;
}
function friendlyMailError(err){
  const msg=String(err?.message||err||"");
  const code=String(err?.code||"");
  if(code==="EAUTH"||/auth|login|password|credentials/i.test(msg)) return "SMTP login failed. Check the full email address and mailbox password.";
  if(code==="ETIMEDOUT"||/ETIMEOUT|timeout|queryA/i.test(msg)) return "SMTP server could not be reached from this machine. Your settings may be correct, but this local network or computer is blocking outbound SMTP. Try again after deployment, or test from another network.";
  if(/ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH/i.test(code+" "+msg)) return "SMTP connection was blocked or refused. Check the host, port and secure setting, or test from the live hosting server.";
  if(/certificate|TLS|SSL/i.test(msg)) return "SMTP secure connection failed. For Namecheap use port 465 with secure SMTP on, or port 587 with secure SMTP off.";
  if(/fetch failed|network|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT/i.test(code+" "+msg)) return "Email API could not be reached from this local server. Your settings may be correct, but this local environment is blocking outbound HTTPS. Try again after deployment or from another network.";
  if(/domain|verify|from/i.test(msg)&&/resend/i.test(msg)) return "Resend could not send from that address. Verify your sending domain in Resend, then use a From address on that domain.";
  return msg||"Unable to send email.";
}

app.set("trust proxy",1);
app.use(express.json({limit:"2mb"}));
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options","SAMEORIGIN");
  next();
});
app.use(session({
  secret:process.env.SESSION_SECRET||require("crypto").randomBytes(32).toString("hex"),
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:IS_PRODUCTION,maxAge:1000*60*60*4}
}));
app.use(express.static(__dirname,{index:"index.html"}));

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/api/health",(req,res)=>res.json({ok:true}));
app.get("/api/config",(req,res)=>{
  const c=effectiveConfig();
  res.json({
    whatsappNumber:c.whatsappNumber||"",
    whatsappMessage:c.whatsappMessage||DEFAULT_WHATSAPP_MESSAGE,
    emailDelivery:c.emailDelivery||"smtp",
    web3formsAccessKey:c.web3formsAccessKey||""
  });
});
const loginLimit=rateLimit({windowMs:15*60*1000,max:10,name:"login"});
const enquiryLimit=rateLimit({windowMs:60*60*1000,max:6,name:"enquiry"});

app.post("/api/admin/login",loginLimit,(req,res)=>{
  if(req.body.password===ADMIN_PASSWORD){req.session.admin=true;return res.json({ok:true})}
  res.status(401).json({error:"Invalid login"});
});
app.post("/api/admin/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
function admin(req,res,next){if(req.session.admin)return next();res.status(401).json({error:"Unauthorized"})}
app.get("/api/admin/config",admin,(req,res)=>{
  const c=effectiveConfig();
  const smtp=smtpConfig(c);
  const resend=resendConfig(c);
  res.json({
    ...c,
    smtpPass:"",
    resendApiKey:"",
    smtpHost:smtp.host,
    smtpPort:String(smtp.port||587),
    smtpSecure:smtp.secure,
    smtpUser:smtp.user,
    smtpFrom:smtp.from,
    smtpPasswordSet:Boolean(smtp.pass),
    emailDelivery:c.emailDelivery||"smtp",
    web3formsAccessKey:c.web3formsAccessKey||"",
    resendFrom:resend.from,
    resendApiKeySet:Boolean(resend.apiKey),
    secretsManagedByEnvironment:IS_PRODUCTION&&!ALLOW_CONFIG_SECRETS
  });
});
app.put("/api/admin/config",admin,(req,res)=>{
  const current=readConfig();
  const email=String(req.body.enquiryEmail||"").trim();
  const whatsapp=String(req.body.whatsappNumber||"").replace(/\D/g,"");
  const message=String(req.body.whatsappMessage||DEFAULT_WHATSAPP_MESSAGE).trim()||DEFAULT_WHATSAPP_MESSAGE;
  const smtpHost=String(req.body.smtpHost||"").trim();
  const smtpPort=String(req.body.smtpPort||"587").trim();
  const smtpSecure=Boolean(req.body.smtpSecure);
  const smtpUser=String(req.body.smtpUser||"").trim();
  const smtpFrom=String(req.body.smtpFrom||"").trim();
  const smtpPass=String(req.body.smtpPass||"");
  const clearSmtpPass=Boolean(req.body.clearSmtpPass);
  const delivery=String(req.body.emailDelivery||"smtp");
  const emailDelivery=["web3forms","resend","smtp"].includes(delivery)?delivery:"smtp";
  const web3formsAccessKey=String(req.body.web3formsAccessKey||"").trim();
  const resendApiKey=String(req.body.resendApiKey||"").trim();
  const resendFrom=String(req.body.resendFrom||"").trim();
  const clearResendApiKey=Boolean(req.body.clearResendApiKey);
  if(email && !isEmail(email)) return res.status(400).json({error:"Invalid email"});
  if(whatsapp && whatsapp.length<8) return res.status(400).json({error:"Invalid WhatsApp number"});
  if(smtpFrom && !isEmail(smtpFrom)) return res.status(400).json({error:"Invalid SMTP from email"});
  if(smtpPort && !/^\d+$/.test(smtpPort)) return res.status(400).json({error:"Invalid SMTP port"});
  if(emailDelivery==="web3forms"&&!web3formsAccessKey) return res.status(400).json({error:"Web3Forms access key is required"});
  if(emailDelivery==="resend"&&!resendApiKey&&!current.resendApiKey&&!process.env.RESEND_API_KEY) return res.status(400).json({error:"Resend API key is required"});
  if(emailDelivery==="resend"&&!resendFrom&&!process.env.RESEND_FROM) return res.status(400).json({error:"Resend from address is required"});
  const next={...current,enquiryEmail:email,whatsappNumber:whatsapp,whatsappMessage:message,smtpHost,smtpPort,smtpSecure,smtpUser,smtpFrom,emailDelivery,web3formsAccessKey,resendFrom};
  if(!ALLOW_CONFIG_SECRETS&&(smtpPass||resendApiKey)) return res.status(400).json({error:"In production, set passwords and API keys as environment variables on your host."});
  if(smtpPass&&ALLOW_CONFIG_SECRETS) next.smtpPass=smtpPass;
  if(clearSmtpPass) delete next.smtpPass;
  if(resendApiKey&&ALLOW_CONFIG_SECRETS) next.resendApiKey=resendApiKey;
  if(clearResendApiKey) delete next.resendApiKey;
  writeConfig(next);res.json({ok:true});
});

app.post("/api/admin/test-email",admin,async(req,res)=>{
  const c=effectiveConfig();
  const to=String(req.body?.to||c.enquiryEmail||"").trim();
  if((c.emailDelivery||"smtp")==="web3forms"){
    if(!c.web3formsAccessKey) return res.status(400).json({error:"Web3Forms access key is required"});
    return res.json({ok:true,message:"Web3Forms is selected. The browser test will send the real test email."});
  }
  if((c.emailDelivery||"smtp")==="resend"){
    try{
      await sendResendWithConfig(c,{
        to,
        subject:"Sterling Housing Solutions email test",
        text:`This is a test email from the Sterling Housing Solutions website admin.

Sent: ${new Date().toISOString()}

If you received this, Resend email delivery is working.`
      });
      return res.json({ok:true,message:`Test email sent to ${to} using Resend.`});
    }catch(err){
      return res.status(400).json({error:friendlyMailError(err)});
    }
  }
  try{
    await sendMailWithConfig(c,{
      to,
      subject:"Sterling Housing Solutions email test",
      text:`This is a test email from the Sterling Housing Solutions website admin.

Sent: ${new Date().toISOString()}

If you received this, SMTP email delivery is working.`
    });
    res.json({ok:true,message:`Test email sent to ${to}.`});
  }catch(err){
    res.status(400).json({error:friendlyMailError(err)});
  }
});

app.get("/api/admin/enquiries",admin,(req,res)=>{
  const items=readEnquiries().sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));
  res.json({items});
});

app.patch("/api/admin/enquiries/:id",admin,(req,res)=>{
  const items=readEnquiries();
  const item=items.find(x=>x.id===req.params.id);
  if(!item) return res.status(404).json({error:"Enquiry not found"});
  if(req.body.status){
    const status=String(req.body.status);
    if(!VALID_STATUSES.has(status)) return res.status(400).json({error:"Invalid status"});
    item.status=status;
  }
  if("notes" in req.body) item.notes=cleanText(req.body.notes,2000);
  item.updatedAt=new Date().toISOString();
  writeEnquiries(items);
  res.json({ok:true,item});
});

app.post("/api/enquiries",enquiryLimit,async(req,res)=>{
  const c=effectiveConfig();
  const data=req.body||{};
  const fields=sanitizeFields(data.fields||{});
  const validationError=validateEnquiry(data,fields);
  if(validationError) return res.status(400).json({error:validationError});
  const record={
    id:`SHS-${Date.now().toString(36).toUpperCase()}`,
    userType:cleanText(data.userType||"website",40),
    managerType:cleanText(data.managerType||"",40),
    fields,
    summary:enquirySummary(fields),
    page:cleanText(data.page||"",300),
    submittedAt:String(data.submittedAt||new Date().toISOString()),
    status:"new",
    notes:"",
    emailSent:false,
    emailError:""
  };
  const items=readEnquiries();
  items.push(record);
  writeEnquiries(items);

  if((c.emailDelivery||"smtp")==="web3forms"){
    res.json({ok:true,id:record.id,emailSent:false,emailDelivery:"web3forms"});
    return;
  }
  if((c.emailDelivery||"smtp")==="resend"){
    try{
      await sendResendWithConfig(c,{
        to:c.enquiryEmail,
        subject:`New ${data.userType||"website"} damp & mould enquiry`,
        text:enquiryEmailText(record)
      });
      record.emailSent=true;
      writeEnquiries(items);
      res.json({ok:true,id:record.id,emailSent:true,emailDelivery:"resend"});
    }catch(err){
      console.error("Unable to send Resend email:",err.message);
      record.emailError=friendlyMailError(err);
      writeEnquiries(items);
      res.json({ok:true,id:record.id,emailSent:false,emailDelivery:"resend"});
    }
    return;
  }

  try{
    await sendMailWithConfig(c,{
      to:c.enquiryEmail,
      subject:`New ${data.userType||"website"} damp & mould enquiry`,
      text:enquiryEmailText(record)
    });
    record.emailSent=true;
    writeEnquiries(items);
    res.json({ok:true,id:record.id,emailSent:true});
  }catch(err){
    console.error("Unable to send enquiry email:",err.message);
    record.emailError=friendlyMailError(err);
    writeEnquiries(items);
    res.json({ok:true,id:record.id,emailSent:false});
  }
});

app.listen(PORT,()=>console.log(`Sterling website running on http://localhost:${PORT}`));
