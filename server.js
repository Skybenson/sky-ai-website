import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/config",(_req,res)=>{
  res.json({
    supabaseUrl:process.env.SUPABASE_URL || "",
    supabaseAnonKey:process.env.SUPABASE_ANON_KEY || ""
  });
});
app.get("/api/health",(_req,res)=>res.json({ok:true,mode:"free-only",aiEnabled:false}));
app.get("*",(req,res,next)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"API route not found."});
  res.sendFile(path.join(__dirname,"public","index.html"),err=>err&&next(err));
});
app.listen(PORT,()=>console.log(`Sky free-only website running on port ${PORT}`));
