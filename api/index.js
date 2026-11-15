// Vercel invokes this handler directly; it never opens a listening socket.
export default async function handler(req,res){
 const {mongoHandler}=await import('../mongo-storage.js');
 return mongoHandler(req,res);
}
