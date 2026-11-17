import { put, list, del } from '@vercel/blob';
const FILE='data/catalog.json', DEFAULT_NAME='محل بيع مخاوير امارتية';
async function readCatalog(){const r=await list({prefix:FILE,limit:10});const b=r.blobs.find(x=>x.pathname===FILE);if(!b)return {products:[],orders:[],shopName:DEFAULT_NAME,settings:{}};const q=await fetch(b.url,{cache:'no-store'});if(!q.ok)throw Error('تعذر قراءة ملف بيانات المتجر');const d=await q.json();if(Array.isArray(d))return {products:d,orders:[],shopName:DEFAULT_NAME,settings:{}};return {...d,products:Array.isArray(d.products)?d.products:[],orders:Array.isArray(d.orders)?d.orders:[],shopName:d.shopName||DEFAULT_NAME,settings:d.settings&&typeof d.settings==='object'?d.settings:{}}}
async function writeCatalog(d){await put(FILE,JSON.stringify(d),{access:'public',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'})}
function auth(p){if(!process.env.ADMIN_PASSWORD)throw Error('إعداد كلمة مرور الإدارة غير موجود');if(p!==process.env.ADMIN_PASSWORD){let e=Error('الرمز السري غير صحيح');e.status=401;throw e}}
function imageData(s,max=900*1024){let m=/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(s||'');if(!m)throw Error('صيغة صورة غير مدعومة');let buf=Buffer.from(m[2],'base64');if(buf.length>max)throw Error('حجم الصورة كبير بعد الضغط');return {buf,type:m[1]==='png'?'image/png':m[1]==='webp'?'image/webp':'image/jpeg',ext:m[1]==='png'?'png':m[1]==='webp'?'webp':'jpg'}}
async function saveImages(id,arr){if(!Array.isArray(arr)||arr.length>10)throw Error('الحد الأقصى 10 صور');let out=[];for(let i=0;i<arr.length;i++){let x=imageData(arr[i]);let b=await put('products/'+id+'/'+(i+1)+'-'+Date.now()+'.'+x.ext,x.buf,{access:'public',addRandomSuffix:true,contentType:x.type});out.push(b.url)}return out}
async function cleanupProductImages(products){const keep=new Set(products.flatMap(p=>[...(Array.isArray(p.images)?p.images:[]),p.image].filter(Boolean).map(x=>typeof x==='string'?x:x.url)));const r=await list({prefix:'products/',limit:1000});const unused=r.blobs.filter(b=>!keep.has(b.url));if(unused.length)await del(unused.map(b=>b.url))}
async function cleanupOrderReceipt(orders,oldUrl){if(!oldUrl)return;const stillUsed=orders.some(o=>o.receipt===oldUrl);if(!stillUsed)await del(oldUrl)}
function cleanText(v,n=160){return String(v||'').trim().slice(0,n)}
export default async function handler(req,res){res.setHeader('Cache-Control','no-store');try{
if(req.method==='GET'){let d=await readCatalog();return res.status(200).json(d)}
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
let body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
if(body.action==='createOrder'){
 let items=Array.isArray(body.items)?body.items:[];if(!items.length)return res.status(400).json({error:'سلة المشتريات فارغة'});
 let d=await readCatalog(),orderItems=[];
 for(const item of items){let p=d.products.find(x=>String(x.id)===String(item.id));if(!p)return res.status(400).json({error:'أحد المنتجات لم يعد متوفراً'});let qty=Math.max(1,Math.min(50,Number(item.qty)||1));orderItems.push({id:p.id,name:p.name,price:p.price||'',qty})}
 let phone=cleanText(body.buyerWhatsapp,30);if(!phone)return res.status(400).json({error:'أدخل رقم واتساب العميل'});
 if(!body.receipt)return res.status(400).json({error:'أرفق صورة سند التحويل'});
 let x=imageData(body.receipt,1200*1024),id=Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
 let blob=await put('orders/'+id+'/receipt.'+x.ext,x.buf,{access:'public',addRandomSuffix:true,contentType:x.type});
 let order={id,items:orderItems,buyerWhatsapp:phone,location:cleanText(body.location,500),receipt:blob.url,status:'pending',createdAt:new Date().toISOString()};
 d.orders.unshift(order);try{await writeCatalog(d)}catch(e){await del(blob.url);throw e}
 return res.status(200).json({ok:true,orderId:id})
}
auth(body.password);
let d=await readCatalog();
if(body.action==='login')return res.status(200).json({ok:true});
if(body.action==='saveTheme'){let t=body.theme||{};const color=(v,d)=>/^#[0-9a-fA-F]{6}$/.test(String(v||''))?String(v):d;d.settings={...(d.settings||{}),theme:{primary:color(t.primary,'#6d2747'),background:color(t.background,'#fbf7f3'),headerStart:color(t.headerStart,'#542039'),headerEnd:color(t.headerEnd,'#8e4565'),card:color(t.card,'#ffffff'),text:color(t.text,'#30242a')}};await writeCatalog(d);return res.status(200).json({ok:true})}\nif(body.action==='saveSettings'){let s=body.settings||{};d.settings={accountOwner:cleanText(s.accountOwner,100),bankName:cleanText(s.bankName,100),accountNumber:cleanText(s.accountNumber,100),whatsapp:cleanText(s.whatsapp,20).replace(/[^0-9+]/g,'')};await writeCatalog(d);return res.status(200).json({ok:true})}
if(body.action==='rename'){let n=cleanText(body.shopName,100);if(!n)return res.status(400).json({error:'اكتب اسم المحل'});d.shopName=n;await writeCatalog(d);return res.status(200).json({ok:true})}
if(body.action==='addProduct'||body.action==='updateProduct'){let name=cleanText(body.name,100);if(!name)return res.status(400).json({error:'اكتب اسم المنتج'});let id=body.action==='updateProduct'?String(body.id||''):Date.now()+'-'+Math.random().toString(36).slice(2,8),old=d.products.find(p=>String(p.id)===id);if(body.action==='updateProduct'&&!old)return res.status(404).json({error:'المنتج غير موجود'});let images=Array.isArray(body.images)?await saveImages(id,body.images):(old?.images||[]);let p={id,name,price:cleanText(body.price,80),images};if(images[0])p.image=images[0];d.products=old?d.products.map(x=>String(x.id)===id?p:x):[p,...d.products];await writeCatalog(d);if(old&&Array.isArray(body.images))await cleanupProductImages(d.products);return res.status(200).json({ok:true,product:p})}
if(body.action==='deleteProduct'){let p=d.products.find(x=>String(x.id)===String(body.id));if(!p)return res.status(404).json({error:'المنتج غير موجود'});d.products=d.products.filter(x=>String(x.id)!==String(body.id));await writeCatalog(d);await cleanupProductImages(d.products);return res.status(200).json({ok:true})}
if(body.action==='updateOrderStatus'){let o=d.orders.find(x=>String(x.id)===String(body.id));if(!o)return res.status(404).json({error:'الطلب غير موجود'});if(!['done','rejected','pending'].includes(body.status))return res.status(400).json({error:'حالة غير صحيحة'});o.status=body.status;await writeCatalog(d);return res.status(200).json({ok:true})}
if(body.action==='deleteOrder'){let o=d.orders.find(x=>String(x.id)===String(body.id));if(!o)return res.status(404).json({error:'الطلب غير موجود'});d.orders=d.orders.filter(x=>String(x.id)!==String(body.id));await writeCatalog(d);await cleanupOrderReceipt(d.orders,o.receipt);return res.status(200).json({ok:true})}
return res.status(400).json({error:'طلب غير معروف'})
}catch(e){console.error(e);return res.status(e.status||500).json({error:e.message||'خطأ داخلي'})}}