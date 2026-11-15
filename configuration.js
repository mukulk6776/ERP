function configurationError(message){
 return Object.assign(Error(message),{status:503,code:'ERP_CONFIGURATION_REQUIRED'});
}
export function validateConfiguration(){
 if(process.env.VERCEL&&!process.env.MONGODB_URI?.trim())throw configurationError('Deployment setup required: add MONGODB_URI to the Production environment variables in Vercel, then redeploy.');
 if(process.env.NODE_ENV==='production'){
  const origin=process.env.ERP_ORIGIN;
  let valid=false;try{valid=!!origin&&new URL(origin).protocol==='https:'&&new URL(origin).origin===origin;}catch{}
  if(!valid||process.env.ERP_SECURE_COOKIE!=='1')throw configurationError('Deployment setup required: set ERP_ORIGIN to the exact HTTPS website origin (without a trailing slash) and ERP_SECURE_COOKIE=1 in Vercel, then redeploy.');
 }
}
