import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bejgqjtvkqanzuihby.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res,status,body){res.status(status).setHeader('Content-Type','application/json').json(body);}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  if(!SUPABASE_SECRET_KEY) return json(res,500,{error:'SUPABASE_SECRET_KEY belum dipasang di Vercel.'});
  try{
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    const {invitationId}=req.body||{};
    if(!token||!invitationId) return json(res,400,{error:'Invitation dan sesi wajib tersedia.'});

    const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error:userError}=await admin.auth.getUser(token);
    if(userError||!user) return json(res,401,{error:'Sesi member tidak valid.'});

    const {data:inv,error:invError}=await admin.from('company_invitations').select('*').eq('id',invitationId).maybeSingle();
    if(invError) throw invError;
    if(!inv) return json(res,404,{error:'Undangan tidak ditemukan.'});
    if(inv.status!=='pending') return json(res,409,{error:'Undangan ini sudah digunakan atau dibatalkan.'});
    if(new Date(inv.expires_at)<new Date()) return json(res,410,{error:'Undangan sudah kedaluwarsa.'});
    if(String(user.email||'').toLowerCase()!==String(inv.email||'').toLowerCase()){
      return json(res,403,{error:'Email akun tidak cocok dengan email undangan.'});
    }

    const {data:profile}=await admin.from('profiles').select('id').eq('id',user.id).maybeSingle();
    if(!profile){
      await admin.from('profiles').insert({
        id:user.id,name:user.user_metadata?.name||user.email?.split('@')[0]||'User',
        email:user.email||'',status:'active'
      });
    }

    const {data:existing,error:existingError}=await admin.from('company_users')
      .select('id').eq('company_id',inv.company_id).eq('user_id',user.id).maybeSingle();
    if(existingError) throw existingError;

    let companyUserId=existing?.id;
    if(existing){
      const {error}=await admin.from('company_users').update({role:inv.role,status:'active'}).eq('id',existing.id);
      if(error) throw error;
    }else{
      const {data:member,error}=await admin.from('company_users').insert({
        company_id:inv.company_id,user_id:user.id,role:inv.role,status:'active'
      }).select('id').single();
      if(error) throw error;
      companyUserId=member.id;
    }

    if(Array.isArray(inv.branch_ids)){
      await admin.from('company_user_branches').delete().eq('company_user_id',companyUserId);
      if(inv.branch_ids.length){
        const rows=inv.branch_ids.map(branch_id=>({company_user_id:companyUserId,branch_id}));
        const {error}=await admin.from('company_user_branches').insert(rows);
        if(error) throw error;
      }
    }

    const {error:updateInviteError}=await admin.from('company_invitations').update({
      status:'accepted',accepted_at:new Date().toISOString()
    }).eq('id',inv.id);
    if(updateInviteError) throw updateInviteError;

    return json(res,200,{ok:true,companyId:inv.company_id,role:inv.role});
  }catch(e){
    console.error(e);
    return json(res,500,{error:e.message||'Gagal menerima undangan.'});
  }
}