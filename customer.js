/* Customer preview is isolated from the private owner Studio. No generation or purchase action. */
(function () {
  'use strict';
  const ORIGIN = 'https://fwhsngnjwwlzdgkrdzrp.supabase.co';
  const API = ORIGIN + '/functions/v1/studio-customer';
  // Public browser key only. Never place a service-role key or Studio token here.
  const PUBLIC_KEY = 'sb_publishable_o8G1lMvv3U2zGLBGIzRYzw_0N0QIdYd';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeImageUrl(value) {
    try { const u = new URL(value); return u.origin === ORIGIN && u.pathname.startsWith('/storage/v1/object/sign/') ? u.href : ''; }
    catch { return ''; }
  }
  function readSession(value, now = Date.now()) {
    if (!value || typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token) return null;
    const expires = Number(value.expires_at) || Math.floor(now / 1000) + Number(value.expires_in || 0);
    return Number.isFinite(expires) && expires > 0 ? {access_token: value.access_token, refresh_token: value.refresh_token, expires_at: expires} : null;
  }
  function quoteText(data) {
    const quote = data.quote || data.creditQuote || data;
    const credits = Number(quote.credits ?? quote.creditCost ?? quote.customerCredits ?? quote.requiredCredits);
    return Number.isFinite(credits) && credits >= 1 ? `${credits} Peter Credits (draft estimate).` : 'Draft quote returned without a credit price. Generation remains unavailable.';
  }
  const helpers = {escapeHtml, safeImageUrl, readSession, quoteText};
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (typeof document === 'undefined') return;
  const byId = id => document.getElementById(id);
  if (!byId('customerView')) return;
  const storeKey = 'pcs.customer.session.v1';
  let session = null, busy = false, epoch = 0, demo = false;
  try { session = readSession(JSON.parse(sessionStorage.getItem(storeKey))); } catch { /* Sign-in remains available if storage is denied. */ }
  function persist(value) {
    session = value;
    try { if (value) sessionStorage.setItem(storeKey, JSON.stringify(value)); else sessionStorage.removeItem(storeKey); } catch { /* Memory-only session. */ }
  }
  function status(text, error = false) { byId('customerStatus').textContent = text; byId('customerStatus').className = error ? 'bad' : 'm'; }
  function clearSession(message = 'Signed out.') {
    epoch++;
    demo = false;
    byId('customerSignOut').textContent = 'Sign out';
    persist(null);
    byId('customerSignIn').classList.remove('hide');
    byId('customerAccount').classList.add('hide');
    for (const id of ['customerIdentity','customerBalance','customerPlans','customerAssets','customerLibraryStatus','customerQuoteResult']) byId(id).textContent = '';
    byId('customerPassword').value = '';
    byId('customerPrompt').value = '';
    status(message);
  }
  async function jsonResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error?.message || data.error || data.msg || data.message || 'Request failed.'), {status: response.status});
    return data;
  }
  async function auth(grant, body) {
    return jsonResponse(await fetch(ORIGIN + '/auth/v1/token?grant_type=' + grant, {method:'POST', headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'}, body:JSON.stringify(body)}));
  }
  let refreshPromise = null;
  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const current = session, started = epoch;
    if (!current) throw new Error('Sign in to continue.');
    refreshPromise = (async () => {
      try {
        const next = readSession(await auth('refresh_token', {refresh_token:current.refresh_token}));
        if (!next) throw new Error('The session could not be renewed.');
        if (epoch !== started) throw new Error('Session changed. Sign in again.');
        persist(next);
      } catch (error) { if (epoch === started) clearSession('Session expired. Please sign in again.'); throw error; }
      finally { refreshPromise = null; }
    })();
    return refreshPromise;
  }
  async function api(action, body) {
    if (!session) throw new Error('Sign in to continue.');
    if (session.expires_at * 1000 < Date.now() + 30000) await refresh();
    const request = () => fetch(API + '?action=' + encodeURIComponent(action), {method:body ? 'POST' : 'GET',headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+session.access_token,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify({action,...body})} : {})});
    let response = await request();
    if (response.status === 401) { await refresh(); response = await request(); }
    if (response.status === 401) clearSession('Session expired. Please sign in again.');
    return jsonResponse(response);
  }
  function renderPlans(data) {
    const plans = data.plans || data.subscriptionPlans || [];
    byId('customerPlans').innerHTML = plans.length ? plans.map(plan => '<article class="card"><h3>'+escapeHtml(plan.name || plan.code || 'Plan')+'</h3><p>'+escapeHtml(plan.credits ?? plan.monthlyCredits ?? plan.includedCredits ?? '—')+' Peter Credits</p><p>'+escapeHtml(Number.isFinite(Number(plan.priceCents)) ? '$'+(Number(plan.priceCents)/100).toFixed(2)+'/month' : 'Price pending')+'</p><p class="m">Draft — unavailable for purchase</p></article>').join('') : '<p class="m">Draft plans are not available.</p>';
  }
  async function loadAccount() {
    const started = epoch;
    status('Loading your account…');
    const results = await Promise.allSettled([api('me'),api('pricing'),api('library')]);
    if (started !== epoch || !session) return;
    const [me, pricing, library] = results;
    if (me.status === 'rejected') throw me.reason;
    const info = me.value;
    byId('customerIdentity').textContent = info.user?.email || info.email || 'Your account';
    byId('customerBalance').textContent = String(info.credits ?? info.balance ?? info.user?.credits ?? 'Unavailable');
    byId('customerSignIn').classList.add('hide'); byId('customerAccount').classList.remove('hide');
    if (pricing.status === 'fulfilled') renderPlans(pricing.value); else byId('customerPlans').textContent = 'Plans unavailable. Try reopening this tab.';
    if (library.status === 'fulfilled') {
      const assets = library.value.assets || [];
      byId('customerLibraryStatus').textContent = assets.length ? assets.length+' stored asset(s)' : 'No assets yet.';
      byId('customerAssets').innerHTML = assets.map(asset => {const url = safeImageUrl(asset.url); return '<article class="card">'+(url ? '<img loading="lazy" src="'+escapeHtml(url)+'" alt="Generated asset">' : '')+'<p>'+escapeHtml(asset.prompt || 'Generated asset')+'</p><p class="m">'+escapeHtml(asset.generationStatus || asset.status || '')+'</p><p class="m">QA: '+escapeHtml(asset.qaStatus || 'PENDING')+'</p></article>';}).join('');
    } else byId('customerLibraryStatus').textContent = 'Assets unavailable. Try reopening this tab.';
    status('Signed in. Draft preview only.');
  }
  byId('customerTab').addEventListener('click', () => {
    byId('studioView').classList.add('hide'); byId('libraryView').classList.add('hide'); byId('locked').classList.add('hide'); byId('customerView').classList.remove('hide');
    if (!PUBLIC_KEY) { status('Customer preview awaits public-key configuration. Sign-in is unavailable.', true); byId('customerSignInButton').disabled = true; return; }
    if (demo) return;
    if (session) loadAccount().catch(error => status(error.message, true)); else status('Sign in with an existing Studio customer account.');
  });
  for (const id of ['studioTab','libraryTab']) byId(id).addEventListener('click', () => {
    byId('customerView').classList.add('hide');
    if (!new URLSearchParams(location.hash.slice(1)).get('token')) { byId('locked').classList.remove('hide'); byId('studioView').classList.add('hide'); byId('libraryView').classList.add('hide'); }
  });
  byId('customerSignOut').addEventListener('click', async () => {
    if (demo) { demo = false; epoch++; byId('customerAccount').classList.add('hide'); byId('customerSignIn').classList.remove('hide'); byId('customerSignOut').textContent = 'Sign out'; status('Preview closed. Sign in for your real account.'); return; }
    const current = session;
    clearSession();
    if (current) {
      try {
        const response = await fetch(ORIGIN + '/auth/v1/logout?scope=local', {method:'POST', headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+current.access_token}});
        if (!response.ok && response.status !== 401 && !session) status('Signed out on this tab. Server session revocation could not be confirmed.');
      } catch { if (!session) status('Signed out on this tab. Server session revocation could not be confirmed.'); }
    }
  });
  byId('customerDemo').addEventListener('click', () => {
    epoch++; demo = true;
    byId('studioView').classList.add('hide'); byId('libraryView').classList.add('hide'); byId('locked').classList.add('hide'); byId('customerView').classList.remove('hide');
    byId('customerSignIn').classList.add('hide'); byId('customerAccount').classList.remove('hide');
    byId('customerPassword').value = '';
    byId('customerIdentity').textContent = 'Sample account — interface preview';
    byId('customerBalance').textContent = '150 (sample credits, no cash value)';
    byId('customerSignOut').textContent = 'Exit preview';
    renderPlans({plans:[{name:'Starter',monthlyCredits:150,priceCents:1900},{name:'Creator',monthlyCredits:400,priceCents:3900},{name:'Pro',monthlyCredits:900,priceCents:7900}]});
    byId('customerLibraryStatus').textContent = 'Sample library — no private assets loaded.';
    byId('customerAssets').innerHTML = '';
    byId('customerPrompt').value = 'A futuristic creative studio with a glowing violet orb';
    byId('customerQuoteResult').textContent = 'Try the quote button to preview the interaction. All values here are examples.';
    status('DEMO: sample data only. No login, payments, generation or account changes.');
  });
  byId('customerSignIn').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !PUBLIC_KEY) return; busy = true; byId('customerSignInButton').disabled = true;
    const started = epoch;
    try {
      const body = {email:byId('customerEmail').value.trim(),password:byId('customerPassword').value};
      byId('customerPassword').value = ''; status('Signing in…');
      const next = readSession(await auth('password', body));
      if (!next) throw new Error('Sign-in response did not include a valid session.');
      if (started !== epoch) return;
      persist(next); await loadAccount();
    } catch (error) { if (started === epoch) status(error.message, true); }
    finally { busy = false; byId('customerSignInButton').disabled = false; }
  });
  byId('customerQuoteForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (demo) {
      if (!byId('customerPrompt').value.trim()) return;
      byId('customerQuoteResult').textContent = 'Example only: 1 Peter Credit. This is sample data, not a live quote. No credits will be charged.';
      return;
    }
    if (busy || !session) return;
    const prompt = byId('customerPrompt').value.trim(); if (!prompt) return;
    busy = true; byId('customerQuoteButton').disabled = true;
    const started = epoch;
    byId('customerQuoteResult').textContent = 'Calculating draft quote…';
    try { const data = await api('quote', {prompt,aspectRatio:byId('customerRatio').value,quality:byId('customerQuality').value}); if (started === epoch) byId('customerQuoteResult').textContent = quoteText(data); }
    catch (error) { if (started === epoch) byId('customerQuoteResult').textContent = error.message; }
    finally { busy = false; byId('customerQuoteButton').disabled = false; }
  });
  if (new URLSearchParams(location.search || '').get('preview') === 'demo') byId('customerDemo').click();
})();
