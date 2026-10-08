import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bejgqjtvkqanzuihby.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res,status,body){
  res.status(status).setHeader('Content-Type','application/json').json(body);
}

export default async function handler(req,res){
  if(req.method !== 'POST') return json(res,405,{error:'Method not allowed'});
  if(!SUPABASE_SECRET_KEY) return json(res,500,{error:'SUPABASE_SECRET_KEY belum dipasang di Vercel.'});

  try{
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    if(!token) return json(res,401,{error:'Sesi Owner tidak ditemukan.'});

    const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error:userError}=await admin.auth.getUser(token);
    if(userError||!user) return json(res,401,{error:'Sesi Owner tidak valid.'});

    const {email,name,role,branchIds,companyId}=req.body||{};
    const normalizedEmail=String(email||'').trim().toLowerCase();
    if(!normalizedEmail||!companyId||!role) return json(res,400,{error:'Email, perusahaan, dan role wajib diisi.'});

    const {data:membership,error:membershipError}=await admin
      .from('company_users').select('id,role,status').eq('company_id',companyId).eq('user_id',user.id).maybeSingle();
    if(membershipError) throw membershipError;
    if(!membership||membership.status!=='active'||membership.role!=='owner'){
      return json(res,403,{error:'Hanya Owner aktif yang dapat mengundang member.'});
    }

    const validRoles=['owner','manajer','kasir','marketing','gudang'];
    const normalizedRole=String(role).toLowerCase();
    if(!validRoles.includes(normalizedRole)) return json(res,400,{error:'Role tidak valid.'});

    const branches=Array.isArray(branchIds)?branchIds.filter(Boolean):[];
    if(!branches.length) return json(res,400,{error:'Pilih minimal satu cabang.'});

    const {data:company,error:companyError}=await admin.from('companies').select('id,name').eq('id',companyId).single();
    if(companyError) throw companyError;

    const {data:existingInvite}=await admin.from('company_invitations')
      .select('id,status,expires_at').eq('company_id',companyId).eq('email',normalizedEmail).eq('status','pending')
      .gt('expires_at',new Date().toISOString()).limit(1).maybeSingle();
    if(existingInvite) return json(res,409,{error:'Undangan untuk email ini masih aktif.'});

    const {data:inv,error:invError}=await admin.from('company_invitations').insert({
      company_id:companyId,email:normalizedEmail,name:String(name||'').trim(),role:normalizedRole,
      branch_ids:branches,invited_by:user.id,status:'pending',
      expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString()
    }).select().single();
    if(invError) throw invError;

    const origin=req.headers.origin || 'https://nexora-jet-kappa.vercel.app';
    const redirectTo=origin+'/?invite='+encodeURIComponent(inv.id);

    let inviteError=null;
    const inviteResult=await admin.auth.admin.inviteUserByEmail(normalizedEmail,{
      data:{name:String(name||'').trim(),nexora_invitation_id:inv.id},
      redirectTo
    });
    inviteError=inviteResult.error;

    if(inviteError){
      const msg=String(inviteError.message||'').toLowerCase();
      if(msg.includes('already')||msg.includes('registered')||msg.includes('exists')){
        if(!process.env.RESEND_API_KEY){
          await admin.from('company_invitations').update({status:'cancelled'}).eq('id',inv.id);
          return json(res,409,{error:'Email ini sudah memiliki akun NEXORA. Untuk mengirim link login ke akun yang sudah ada, pasang RESEND_API_KEY di Vercel.'});
        }
        const {data:linkData,error:linkError}=await admin.auth.admin.generateLink({
          type:'magiclink',email:normalizedEmail,options:{redirectTo}
        });
        if(linkError) throw linkError;
        const actionLink=linkData?.properties?.action_link;
        if(!actionLink) throw new Error('Link login gagal dibuat.');
        const from=process.env.RESEND_FROM || 'NEXORA <onboarding@resend.dev>';
        const html='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#172033"><h1 style="margin:0 0 8px">Undangan NEXORA</h1><p><b>'+(name||normalizedEmail)+'</b>, kamu diundang bergabung ke <b>'+company.name+'</b> sebagai <b>'+normalizedRole.toUpperCase()+'</b>.</p><p><a href="'+actionLink+'" style="display:inline-block;background:#635bff;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Terima & Masuk ke NEXORA</a></p><p style="font-size:12px;color:#718096">Link ini dibuat khusus untuk akun email ini.</p></div>';
        const resend=await fetch('https://api.resend.com/emails',{
          method:'POST',headers:{'Authorization':'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
          body:JSON.stringify({from,to:[normalizedEmail],subject:'Undangan bergabung ke '+company.name+' di NEXORA',html})
        });
        if(!resend.ok) throw new Error('Email undangan gagal dikirim melalui Resend.');
      }else{
        await admin.from('company_invitations').update({status:'cancelled'}).eq('id',inv.id);
        return json(res,400,{error:inviteError.message||'Gagal mengirim undangan.'});
      }
    }

    return json(res,200,{ok:true,invitationId:inv.id,message:'Undangan berhasil dikirim ke '+normalizedEmail});
  }catch(e){
    console.error(e);
    return json(res,500,{error:e.message||'Gagal membuat undangan member.'});
  }
}