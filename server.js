const express=require("express");
const session=require("express-session");
const nodemailer=require("nodemailer");
const fs=require("fs");
const path=require("path");

const app=express();
const PORT=process.env.PORT||3000;
const CONFIG=path.join(__dirname,"config.json");
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;

if(!ADMIN_PASSWORD){
  console.error("ADMIN_PASSWORD environment variable is required.");
  process.exit(1);
}

function readConfig(){
  try{return JSON.parse(fs.readFileSync(CONFIG,"utf8"))}
  catch{return {enquiryEmail:"",whatsappNumber:"",whatsappMessage:"Hi Sterling Housing Solutions, I need help with a damp or mould issue."}}
}
function writeConfig(c){fs.writeFileSync(CONFIG,JSON.stringify(c,null,2))}

app.use(express.json({limit:"2mb"}));
app.use(session({
  secret:process.env.SESSION_SECRET||require("crypto").randomBytes(32).toString("hex"),
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:1000*60*60*4}
}));
app.use(express.static(__dirname,{index:"index.html"}));

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"admin.html")));
app.get("/api/config",(req,res)=>{
  const c=readConfig();
  res.json({whatsappNumber:c.whatsappNumber||"",whatsappMessage:c.whatsappMessage||""});
});
app.post("/api/admin/login",(req,res)=>{
  if(req.body.password===ADMIN_PASSWORD){req.session.admin=true;return res.json({ok:true})}
  res.status(401).json({error:"Invalid login"});
});
app.post("/api/admin/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
function admin(req,res,next){if(req.session.admin)return next();res.status(401).json({error:"Unauthorized"})}
app.get("/api/admin/config",admin,(req,res)=>res.json(readConfig()));
app.put("/api/admin/config",admin,(req,res)=>{
  const current=readConfig();
  const email=String(req.body.enquiryEmail||"").trim();
  const whatsapp=String(req.body.whatsappNumber||"").replace(/\D/g,"");
  const message=String(req.body.whatsappMessage||"").trim();
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Invalid email"});
  const next={...current,enquiryEmail:email,whatsappNumber:whatsapp,whatsappMessage:message};
  writeConfig(next);res.json({ok:true});
});

app.post("/api/enquiries",async(req,res)=>{
  const c=readConfig();
  if(!c.enquiryEmail) return res.status(503).json({error:"Enquiry email has not been configured yet."});
  if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS)
    return res.status(503).json({error:"Email service has not been configured yet."});

  const data=req.body||{};
  const fields=data.fields||{};
  const rows=Object.entries(fields).map(([k,v])=>`${k}: ${String(v)}`).join("\n");
  const text=`New Sterling Housing Solutions enquiry

User type: ${data.userType||""}
Housing/landlord type: ${data.managerType||""}
Submitted: ${data.submittedAt||new Date().toISOString()}

${rows}`;

  const transport=nodemailer.createTransport({
    host:process.env.SMTP_HOST,
    port:Number(process.env.SMTP_PORT||587),
    secure:String(process.env.SMTP_SECURE||"false")==="true",
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}
  });
  await transport.sendMail({
    from:process.env.SMTP_FROM||process.env.SMTP_USER,
    to:c.enquiryEmail,
    subject:`New ${data.userType||"website"} damp & mould enquiry`,
    text
  });
  res.json({ok:true});
});

app.listen(PORT,()=>console.log(`Sterling website running on http://localhost:${PORT}`));
