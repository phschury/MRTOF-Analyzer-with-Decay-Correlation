document.getElementById('newSessionButton').addEventListener('click',async()=>{
  const button=document.getElementById('newSessionButton');
  const status=document.getElementById('sessionStatus');
  button.disabled=true;
  try{
    const response=await fetch('/api/session/new',{method:'POST'});
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Could not start a new session.');
    status.textContent='New session started. All open viewers have been reset.';
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
});
