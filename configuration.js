export function validateConfiguration(){
 if(process.env.VERCEL&&!process.env.MONGODB_URI)throw Error('Set MONGODB_URI in Vercel environment variables.');
 if(process.env.NODE_ENV==='production'){
  const origin=process.env.ERP_ORIGIN;
  let valid=false;try{valid=!!origin&&new URL(origin).protocol==='https:'&&new URL(origin).origin===origin;}catch{}
  if(!valid||process.env.ERP_SECURE_COOKIE!=='1')throw Error('Set ERP_ORIGIN to the exact HTTPS website origin and ERP_SECURE_COOKIE=1.');
 }
}
