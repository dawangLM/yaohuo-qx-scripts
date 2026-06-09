/**
 * 中国联通 Surge 版 v1.2.6-port
 * - HTTP request 模式：抓取 token_online/appId 保存为 chinaUnicomCookie
 * - Cron/Panel 模式：执行登录校验、资产查询、首页签到、签到区任务、月签有礼、天天领现金、通通乡村、权益超市、云盘/安全管家/沃云手机等任务链路。
 * - 高复杂模块已按 Python 链路分批接入 Surge；个别接口若活动侧变更，会在日志输出具体失败原因。
 */

const $ = new Env('中国联通');
const SCRIPT_VERSION = 'v1.2.6';
const UA = 'Dalvik/2.1.0 (Linux; U; Android 12; Mi 10 Pro MIUI/21.11.3);unicom{version:android@11.0802}';
const H5_UA = 'Mozilla/5.0 (Linux; Android 10; MI 8 Build/QKQ1.190828.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/143.0.7499.146 Mobile Safari/537.36; unicom{version:android@11.0802,desmobile:0};devicetype{deviceBrand:Xiaomi,deviceModel:MI 8}';
const ENABLE_SIGN = readBool('UNICOM_ENABLE_SIGN', true);
const ENABLE_LTZF = readBool('UNICOM_ENABLE_LTZF', true);
const ENABLE_TTLXJ = readBool('UNICOM_ENABLE_TTLXJ', true);
const ENABLE_TTXC = readBool('UNICOM_ENABLE_TTXC', true);
const ENABLE_MARKET = readBool('UNICOM_ENABLE_MARKET', true);
const ENABLE_WOREAD = readBool('UNICOM_ENABLE_WOREAD', true);
const ENABLE_AITING = readBool('UNICOM_ENABLE_AITING', true);
const ENABLE_SECURITY = readBool('UNICOM_ENABLE_SECURITY', true);
const ENABLE_LTYP = readBool('UNICOM_ENABLE_LTYP', true);
const ENABLE_WOSTORE = readBool('UNICOM_ENABLE_WOSTORE', true);
const ENABLE_REGIONAL = readBool('UNICOM_ENABLE_REGIONAL', true);
const ENABLE_QUERY = readBool('UNICOM_ENABLE_QUERY', true);
const TEST_MODE = ($.getdata('UNICOM_TEST_MODE') || '').toLowerCase() === 'query';
const XJ_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const XJ_ACTIVITY_ID = `${$.getdata('XJ_ACTIVITY_MONTH') || XJ_MONTHS[new Date().getMonth()]}${$.getdata('XJ_ACTIVITY_YEAR') || new Date().getFullYear()}Act`;
const TTXC_BASE = 'https://epay.10010.com/cu-ca-game-front';
const TTXC_APP_BASE = 'https://epay.10010.com/cu-ca-app-front';
const TTXC_CHANNEL = '225';
const TTXC_REFERER = 'https://epay.10010.com/cu-ca-game-web/index.html?channel=qdqp';

setTimeout(() => {
  main().catch(e => finish(`运行异常: ${formatError(e)}`));
}, 0);

async function main() {
  if (typeof $request !== 'undefined') return captureToken();
  const raw = $.getdata('chinaUnicomCookie') || '';
  if (!raw) return finish('未找到 chinaUnicomCookie，请先打开中国联通 APP 触发抓取');
  const accounts = raw.split(/[&\n]/).map(x => x.trim()).filter(Boolean);
  const notify = [];
  $.log(`中国联通 Surge ${SCRIPT_VERSION} | 共 ${accounts.length} 个账号 | ${enabledSummary()} 查询模式:${TEST_MODE}`);
  for (let i = 0; i < accounts.length; i++) {
    const u = new UserService(i + 1, accounts[i]);
    if (!(await u.ensureLogin())) { u.log('登录失败/Token失效', true); notify.push(...u.notifyLogs); continue; }
    if (ENABLE_QUERY) await u.queryRemain();
    if (ENABLE_SIGN) await u.signTask(TEST_MODE);
    if (ENABLE_LTZF) await u.ltzfTask(TEST_MODE);
    if (ENABLE_TTLXJ) await u.ttlxjTask(TEST_MODE);
    if (ENABLE_TTXC) await u.ttxcTask(TEST_MODE);
    await u.runPendingModules(TEST_MODE);
    notify.push(...u.notifyLogs);
    await wait(1500);
  }
  finish(notify.length ? notify.map(oneLine).join('\n') : '执行完成，暂无通知内容');
}

function captureToken() {
  const url = $request.url || '';
  const headers = $request.headers || {};
  const cookie = headers.Cookie || headers.cookie || '';
  const body = $request.body || '';
  const token = pickParam(url, 'token_online') || pickParam(body, 'token_online') || pickCookie(cookie, 'token_online');
  const appId = pickParam(url, 'appId') || pickParam(body, 'appId') || pickCookie(cookie, 'appId');
  const mobile = pickParam(url, 'desmobile') || pickParam(body, 'desmobile') || pickCookie(cookie, 'desmobile') || pickParam(body, 'mobile');
  if (!token) return $.done({});
  const item = `${token}${appId ? '#'+appId : ''}${mobile && /^1\d{10}$/.test(mobile) ? '#'+mobile : ''}`;
  const old = $.getdata('chinaUnicomCookie') || '';
  const list = old ? old.split(/[&\n]/).filter(Boolean) : [];
  const idx = list.findIndex(x => (mobile && x.includes(mobile)) || x.split('#')[0] === token);
  const isNewOrChanged = idx < 0 || list[idx] !== item;
  if (idx >= 0) list[idx] = item; else list.push(item);
  $.setdata(list.join('&'), 'chinaUnicomCookie');
  const notifyKey = `china_unicom_token_notified_${mobile || token}`;
  if (isNewOrChanged && $.getdata(notifyKey) !== '1') {
    $.setdata('1', notifyKey);
    $.msg('中国联通', 'Token 抓取成功', mask(mobile || token));
  }
  $.done({});
}

class UserService {
  constructor(index, config) {
    this.index = index;
    this.notifyLogs = [];
    const p = config.split('#');
    this.token_online = p[0] || '';
    this.appId = p[1] || '';
    this.mobile = /^1\d{10}$/.test(p[2] || '') ? p[2] : '';
    this.uuid = $.getdata('chinaUnicomUuid') || randomString(32, '0123456789abcdef');
    $.setdata(this.uuid, 'chinaUnicomUuid');
    this.unicomTokenId = randomString(32);
    this.tokenIdCookie = 'chinaunicom-' + randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    this.cookieString = `TOKENID_COOKIE=${this.tokenIdCookie}; UNICOM_TOKENID=${this.unicomTokenId}; sdkuuid=${this.unicomTokenId}; token_online=${this.token_online}` + (this.appId ? `; appId=${this.appId}` : '');
    this.cookieJar = parseCookieString(this.cookieString);
    this.ecs_token = '';
    this.city_info = [];
    this.ttxc_token = '';
    this.unsupportedNotified = false;
  }
  log(msg, notify=false) { const line = `账号[${this.index}]${msg}`; $.log(`[${time()}] ${line}`); if (notify) this.notifyLogs.push(line); }
  cookieHeader(extra='') { return serializeCookies({...this.cookieJar, ...parseCookieString(extra)}); }
  saveResponseCookies(r) {
    const setCookie = r?.headers?.['Set-Cookie'] || r?.headers?.['set-cookie'] || r?.headers?.['set-Cookie'];
    const parsed = parseSetCookie(setCookie);
    if (Object.keys(parsed).length) this.cookieJar = {...this.cookieJar, ...parsed};
  }
  headers(extra={}) { return {'User-Agent': UA, 'Cookie': this.cookieHeader(), ...extra}; }
  async request(method, url, opts={}) {
    const headers = {...this.headers(), ...(opts.headers || {})};
    if (opts.cookie) headers.Cookie = this.cookieHeader(opts.cookie);
    try { const r = await http(method, url, {...opts, headers}); this.saveResponseCookies(r); return r; } catch(e) { this.log(`请求异常 ${url}: ${e}`); return null; }
  }
  warnModule(name, desc='接口返回异常') {
    this.log(`${name}: ${desc}`);
  }
  async runPendingModules(query=false) {
    if (ENABLE_MARKET) await this.marketTask(query);
    if (ENABLE_WOREAD) this.log('联通阅读: 阅读链路待接入，当前仅完成开关预留');
    if (ENABLE_AITING) await this.aitingTask(query);
    if (ENABLE_SECURITY) await this.securityTask(query);
    if (ENABLE_LTYP) await this.cloudDiskTask(query);
    if (ENABLE_WOSTORE) await this.wostoreTask(query);
    if (ENABLE_REGIONAL) await this.regionalTask(query);
  }
  async ensureLogin(max=3) {
    for (let i=1;i<=max;i++) { if (i>1) this.log(`登录重试 ${i}/${max}`); if (await this.onLine()) return true; await wait(1200); }
    return false;
  }
  async onLine() {
    if (!this.token_online) return false;
    const data = {isFirstInstall:'1', netWay:'Wifi', version:'android@11.0000', token_online:this.token_online, provinceChanel:'general', deviceModel:'ALN-AL10', step:'dingshi', androidId:'291a7deb1d716b5a', reqtime:Date.now()};
    if (this.appId) data.appId = this.appId;
    const r = await this.request('post', 'https://m.client.10010.com/mobileService/onLine.htm', {form:data});
    const j = parseJson(r?.body);
    if (j && (j.code === '0' || j.code === 0)) {
      this.saveResponseCookies(r);
      const des = j.desmobile || '';
      if (/^1\d{10}$/.test(des)) this.mobile = des;
      this.ecs_token = j.ecs_token || ''; this.city_info = j.list || [];
      if (this.ecs_token) this.cookieJar.ecs_token = this.ecs_token;
      if (j.t3_token) this.cookieJar.t3_token = j.t3_token;
      this.log(`登录成功 ${mask(this.mobile)}`);
      return true;
    }
    this.log(`登录失败[${j?.code ?? '?'}]: ${j?.msg || ''}`);
    return false;
  }
  async queryRemain() {
    if (!this.ecs_token) return;
    this.log('==== 资产查询 ====');
    const r = await this.request('get', 'https://m.client.10010.com/servicequerybusiness/balancenew/accountBalancenew.htm', {headers:{'User-Agent':UA}, cookie:`ecs_token=${this.ecs_token}`});
    const j = parseJson(r?.body);
    if (j?.code === '0000') {
      const bal = j.curntbalancecust || '0.00', fee = j.realfeecust || '0.00';
      this.log(`💰 [资产-话费] 当前余额: ${bal}元, 实时话费: ${fee}元`, true);
    } else this.log(`套餐余量查询失败: ${j?.desc || j?.msg || '未知错误'}`);
  }
  async signTask(query=false) {
    this.log('==== 首页签到/签到区 ====');
    await this.signGetTelephone(true);
    await this.signGetContinuous(query);
    if (!query) await this.signGetTaskList();
    await this.signMonthGift(query);
    await this.signQueryMyPrizes();
    await this.signGetTelephone(false);
  }
  signCookie() { return `ecs_token=${this.ecs_token}; token_online=${this.token_online}${this.appId ? '; appId='+this.appId : ''}`; }
  async signGetContinuous(query=false) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/signin/getContinuous', {params:{taskId:'', channel:'wode', imei:this.uuid}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html', Origin:'https://img.client.10010.com'}, cookie:this.signCookie()});
    const j = parseJson(r?.body);
    if (j?.code === '0000') {
      const signed = j.data?.todayIsSignIn === 'y'; this.log(`签到区今天${signed ? '已' : '未'}签到`, true);
      if (!signed && !query) await this.signDaySign();
    } else this.log(`签到区查询签到状态失败[${j?.code || '?'}]: ${j?.desc || ''}`);
  }
  async signDaySign() {
    const r = await this.request('post', 'https://activity.10010.com/sixPalaceGridTurntableLottery/signin/daySign', {form:{}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html', Origin:'https://img.client.10010.com'}, cookie:this.signCookie()});
    const j = parseJson(r?.body);
    if (j?.code === '0000') this.log(`签到区签到成功: [${j.data?.statusDesc || ''}]${j.data?.redSignMessage || ''}`, true);
    else if (j?.code === '0002' && String(j.desc||'').includes('已经签到')) this.log('签到区签到成功: 今日已完成签到！');
    else this.log(`签到区签到失败[${j?.code || '?'}]: ${j?.desc || ''}`);
  }
  async signGetTelephone(initial=false) {
    const r = await this.request('post', 'https://act.10010.com/SigninApp/convert/getTelephone', {form:{}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html', Origin:'https://act.10010.com'}});
    const j = parseJson(r?.body);
    if (j?.status === '0000' && j.data) {
      const amount = Number(j.data.telephone || 0);
      if (initial) this.initialAmount = amount;
      else this.log(`签到区-话费红包: 总额 ${amount.toFixed(2)}元`, true);
      return amount;
    }
    return null;
  }
  async signGetTaskList() {
    const url = 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/taskList';
    for (let i=0;i<20;i++) {
      const r = await this.request('get', url, {params:{type:'2'}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html', Origin:'https://img.client.10010.com'}, cookie:this.signCookie()});
      const j = parseJson(r?.body);
      if (!j || j.code !== '0000') { this.log(`签到区-任务中心: 获取任务列表失败[${j?.code || '?'}]: ${j?.desc || ''}`); return; }
      const tags = j.data?.tagList || [], tasks = [...(j.data?.taskList || []), ...tags.flatMap(t => t.taskDTOList || [])].filter(Boolean);
      const doTask = tasks.find(t => t.taskState === '1' && t.taskType === '5');
      if (doTask) { await this.signDoTask(doTask); await wait(2000); continue; }
      const claim = tasks.find(t => t.taskState === '0');
      if (claim) { await this.signGetTaskReward(claim.id); await wait(1000); continue; }
      this.log('签到区-任务中心: 所有任务处理完毕。'); break;
    }
  }
  async gettaskip() { const orderId = randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'); await this.request('post', 'https://m.client.10010.com/taskcallback/topstories/gettaskip', {form:{mobile:this.mobile, orderId}}); return orderId; }
  async signDoTask(task) {
    if (task.url && task.url !== '1' && /^http/.test(task.url)) { await this.request('get', task.url, {headers:{Referer:'https://img.client.10010.com/SigninApp/index.html'}, cookie:this.signCookie()}); await wait(3500); }
    const orderId = await this.gettaskip();
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/completeTask', {params:{taskId:task.id, orderId, systemCode:'QDQD'}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html'}, cookie:this.signCookie()});
    const j = parseJson(r?.body);
    this.log(`签到区-任务中心: ${j?.code === '0000' ? '✅' : '❌'} 任务[${task.taskName}] ${j?.desc || ''}`);
  }
  async signGetTaskReward(taskId) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/getTaskReward', {params:{taskId}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html'}, cookie:this.signCookie()});
    const j = parseJson(r?.body), d = j?.data || {};
    if (j?.code === '0000' && d.code === '0000') this.log(`签到区-领取奖励: [${d.prizeName || ''}] ${d.prizeNameRed || ''}`, true);
    else this.log(`签到区-领取奖励失败[${d.code || j?.code || '?'}]: ${j?.desc || d.desc || ''}`);
  }
  async signMonthGift(query=false) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/floor/getMonthSign', {headers:{Referer:'https://img.client.10010.com/SigninApp/index.html', Origin:'https://img.client.10010.com'}, cookie:this.signCookie()});
    const j = parseJson(r?.body); if (j?.code !== '0000') return this.log(`签到区-月签有礼: 查询失败[${j?.code || '?'}]: ${j?.desc || ''}`);
    const tasks = j.data?.taskList || [], claim = tasks.filter(t => String(t.taskStatus)==='1' && t.taskId && t.id);
    if (query) return this.log(`签到区-月签有礼: 可领取 ${claim.length} 个，已领取 ${tasks.filter(t=>String(t.taskStatus)==='2').length} 个`);
    for (const t of claim) { await this.signGetMonthReward(t); await wait(800); }
  }
  async signGetMonthReward(t) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/getTaskReward', {params:{taskId:t.taskId, taskType:'30', id:t.id}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html'}, cookie:this.signCookie()});
    const j = parseJson(r?.body), d = j?.data || {};
    if (j?.code === '0000' && d.code === '0000') this.log(`签到区-月签有礼: [${t.taskName || '月签奖励'}] ${d.prizeName || ''} ${d.prizeNameRed || ''}`, true);
    else this.log(`签到区-月签有礼领取失败: ${d.desc || j?.desc || ''}`);
  }
  async signQueryMyPrizes() {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/prize/myPrize', {params:{pageNo:1,pageSize:5}, headers:{Referer:'https://img.client.10010.com/SigninApp/index.html'}, cookie:this.signCookie()});
    const j = parseJson(r?.body);
    if (j?.code !== '0000') return;
    const list = j.data?.list || j.data?.records || j.prizeList || [];
    if (list.length) this.log(`签到区-最近奖品: ${list.slice(0,3).map(x => x.prizeName || x.name || x.title || '未知奖品').join('、')}`, true);
  }
  async openPlatLineNew(toUrl) {
    if (!this.ecs_token) return null;
    const r = await this.request('get', 'https://m.client.10010.com/mobileService/openPlatform/openPlatLineNew.htm', {params:{to_url:toUrl}, cookie:`ecs_token=${this.ecs_token}; token_online=${this.token_online}${this.appId ? '; appId='+this.appId : ''}`, followRedirect:false});
    const loc = r?.headers?.Location || r?.headers?.location || '';
    const ticket = (loc.match(/[?&]ticket=([^&]+)/)||[,''])[1];
    const type = (loc.match(/[?&]type=([^&]+)/)||[,''])[1];
    return {location:loc, loc, ticket, type};
  }
  async ltzfTask(query=false) {
    this.log('==== 联通祝福 ====');
    const candidates = [
      'https://wocare.unisk.cn/',
      'https://wocare.unisk.cn/ltzf/',
      'https://wocare.unisk.cn/ltzf/index.html'
    ];
    let last = '';
    for (const url of candidates) {
      const jump = await this.openPlatLineNew(url);
      last = jump?.location || last;
      if (!jump?.location) { await wait(500); continue; }
      const r = await this.request('get', jump.location, {headers:{'User-Agent':H5_UA, Referer:'https://m.client.10010.com/'}, followRedirect:true});
      const body = String(r?.body || '');
      const ok = r && r.status >= 200 && r.status < 400 && !/登录|失效|error/i.test(body.slice(0,300));
      if (/系统升级中|维护中|暂停服务/.test(body)) { this.log('联通祝福: 官方入口显示系统升级中，跳过执行'); return; }
      if (ok) { this.log('联通祝福: 入口鉴权成功', true); return; }
      last = `${r?.status || '?'} ${oneLine(body).slice(0,80)}`;
      await wait(800);
    }
    this.log(`联通祝福: 入口鉴权失败，活动入口可能变更${last ? '，最后响应: '+last : ''}`);
  }
  async ttlxjTask(query=false) {
    this.log('==== 天天领现金 ====');
    for (let i=1; i<=3; i++) {
      const jump = await this.openPlatLineNew('https://epay.10010.com/ci-mps-st-web/ttlxj/');
      if (jump?.ticket) {
        const ok = await this.ttlxjAuthorize(jump.ticket, jump.type, jump.location);
        if (ok && await this.ttlxjAuthCheck()) {
          if (query) return await this.ttlxjQueryAvailable();
          await this.ttlxjDoTasks();
          await this.ttlxjQueryAvailable();
          return;
        }
      }
      if (i < 3) { this.log(`天天领现金: 获取/授权失败，重试 ${i}/3`); await wait(1500); }
    }
    this.log('天天领现金: 获取入口或授权失败，跳过任务');
  }
  async ttlxjAuthorize(ticket, typeVal, refererUrl) {
    const payload = {
      response_type:'rptid',
      client_id:'73b138fd-250c-4126-94e2-48cbcc8b9cbe',
      redirect_uri:'https://epay.10010.com/ci-mps-st-web/',
      login_hint:{credential_type:'st_ticket', credential:ticket, st_type:typeVal || '', force_logout:true, source:'app_sjyyt'},
      device_info:{token_id:`chinaunicom-pro-${Date.now()}-${randomString(13)}`, trace_id:randomString(32)}
    };
    const r = await this.request('post', 'https://epay.10010.com/woauth2/v2/authorize', {json:payload, headers:{'User-Agent':H5_UA, Origin:'https://epay.10010.com', Referer:refererUrl || 'https://epay.10010.com/ci-mps-st-web/ttlxj/'}});
    return !!r && r.status === 200;
  }
  async ttlxjAuthCheck(depth=0) {
    const r = await this.request('post', 'https://epay.10010.com/ps-pafs-auth-front/v1/auth/check', {json:{}, headers:{'User-Agent':H5_UA, bizchannelinfo:this.getBizChannelInfo()}});
    const j = parseJson(r?.body);
    if (j?.code === '0000') {
      const a = j.data?.authInfo || {};
      this.sessionId = a.sessionId || '';
      this.tokenId = a.tokenId || '';
      this.epayUserId = a.userId || '';
      return true;
    }
    const loginUrl = j?.data?.woauth_login_url;
    if (j?.code === '2101000100' && loginUrl && depth < 2) return await this.ttlxjLogin(loginUrl) && await this.ttlxjAuthCheck(depth + 1);
    this.log(`天天领现金: AuthCheck失败[${j?.code || '?'}]: ${j?.msg || responseSummary(j)}`);
    return false;
  }
  async ttlxjLogin(loginUrl) {
    const full = `${loginUrl}https://epay.10010.com/ci-mcss-party-web/clockIn/?bizFrom=225&bizChannelCode=225`;
    const r = await this.request('get', full, {headers:{'User-Agent':H5_UA}, followRedirect:false});
    const loc = r?.headers?.Location || r?.headers?.location || '';
    const body = String(r?.body || '');
    const rptid = (loc.match(/[?&]rptid=([^&]+)/) || body.match(/[?&]rptid=([^&"'<>]+)/) || [,''])[1];
    if (rptid) { this.rptId = rptid; return true; }
    if (r?.status === 200) { this.log('天天领现金: Login返回200，继续AuthCheck验证'); return true; }
    this.log(`天天领现金: Login失败[${r?.status || '?'}]`);
    return false;
  }
  getBizChannelInfo() { return JSON.stringify({bizChannelCode:'225', disriBiz:'party', unionSessionId:'', stType:'', stDesmobile:'', source:'', rptId:this.rptId || '', ticket:'', tongdunTokenId:this.tokenIdCookie, xindunTokenId:this.unicomTokenId}); }
  getEpayAuthInfo() { return JSON.stringify({mobile:'', sessionId:this.sessionId || '', tokenId:this.tokenId || '', userId:this.epayUserId || ''}); }
  async ttlxjDoTasks() {
    const r = await this.request('post', 'https://epay.10010.com/ci-mcss-party-front/v1/ttlxj/userDrawInfo', {json:{}, headers:{'User-Agent':H5_UA, bizchannelinfo:this.getBizChannelInfo(), authinfo:this.getEpayAuthInfo()}});
    const j = parseJson(r?.body);
    if (j?.code !== '0000') return this.log(`天天领现金: 查询失败: ${j?.msg || responseSummary(j)}`);
    const dow = j.data?.dayOfWeek || '';
    const hasNotClocked = j.data?.[`day${dow}`] === '1';
    if (hasNotClocked) { this.log('天天领现金: 今天未打卡', true); await this.ttlxjDraw((new Date().getDay() === 0) ? 'C' : 'B'); }
    else this.log('天天领现金: 今天已打卡', true);
  }
  async ttlxjDraw(type) {
    const r = await this.request('post', 'https://epay.10010.com/ci-mcss-party-front/v1/ttlxj/unifyDrawNew', {form:{drawType:type, bizFrom:'225', activityId:'TTLXJ20210330'}, headers:{'User-Agent':H5_UA, bizchannelinfo:this.getBizChannelInfo(), authinfo:this.getEpayAuthInfo()}});
    const j = parseJson(r?.body);
    if (j?.code === '0000') this.log(`天天领现金: 抽奖成功: ${j.data?.prizeName || '未知奖品'}`, true);
    else this.log(`天天领现金: 抽奖失败: ${j?.msg || responseSummary(j)}`);
  }
  async ttlxjQueryAvailable() {
    const r = await this.request('post', 'https://epay.10010.com/ci-mcss-party-front/v1/ttlxj/queryAvailable', {json:{}, headers:{'User-Agent':H5_UA, bizchannelinfo:this.getBizChannelInfo(), authinfo:this.getEpayAuthInfo()}});
    const j = parseJson(r?.body);
    if (j?.code === '0000') {
      const d = j.data || {}, raw = Number(d.availableAmount || 0), seven = Number(d.sevenDayExpireAmount || 0), min = Number(d.minExpireAmount || 0);
      let msg = `天天领现金: 可用立减金: ${(raw / 100).toFixed(2)}元`;
      if (seven > 0) msg += `, 7天内过期: ${(seven / 100).toFixed(2)}元`;
      if (min > 0 && d.minExpireDate) msg += `, 最早过期: ${(min / 100).toFixed(2)}元 ${d.minExpireDate}`;
      this.log(msg, true);
    } else this.log(`天天领现金: 查询余额失败: ${j?.msg || responseSummary(j)}`);
  }
  ttxcHeaders(auth=true, ecs=false) {
    const h = {'User-Agent':H5_UA, Referer:TTXC_REFERER, Origin:'https://epay.10010.com', 'Content-Type':'application/json', Accept:'*/*', 'X-Requested-With':'com.sinovatech.unicom.ui'};
    if (auth && this.ttxc_token) h.Authorization = this.ttxc_token;
    if (ecs && this.ecs_token) { this.cookieJar.ecs_token = this.ecs_token; h.Cookie = this.cookieHeader(); }
    return h;
  }
  async ttxcPost(path, payload={}, auth=true, withUser=true, ecs=false) {
    const data = {...(payload || {})};
    if (withUser) data.userId = data.userId || this.ttxc_user_id || '';
    data.channel = data.channel || TTXC_CHANNEL;
    const r = await this.request('post', `${TTXC_BASE}${path}`, {json:data, headers:this.ttxcHeaders(auth, ecs)});
    return parseJson(r?.body) || {};
  }
  async ttxcTask(query=false) {
    this.log('==== 通通乡村 ====');
    const ok = await this.ttxcLogin(); if (!ok) return;
    await this.ttxcSign(query);
    const tasks = await this.ttxcGetTasks();
    if (query) {
      const todo = tasks.filter(t => t.taskStatus === 'UNDO').length;
      const claim = tasks.filter(t => t.taskStatus === 'UNCLA').length;
      return this.log(`通通乡村: 待做${todo}个，可领取${claim}个`, true);
    }
    await this.ttxcClaimReadyTasks(tasks);
    await this.ttxcDoJumpTasks(tasks);
    await this.ttxcDoGarbageTask(tasks);
    const tasks2 = await this.ttxcGetTasks();
    await this.ttxcClaimReadyTasks(tasks2);
  }
  async ttxcLogin() {
    if (!this.ecs_token) return this.log('通通乡村: 缺少 ecs_token，跳过'), false;
    if (!(await this.ttxcInitTtGame())) return false;
    const j = await this.ttxcPost('/user/v1/login', {}, false, false, true);
    if (j.code !== 0) { this.log(`通通乡村: 登录失败[${j.code ?? '?'}]: ${j.msg || ''}`); return false; }
    const user = j.data || {};
    this.ttxc_user_id = user.userId || '';
    this.ttxc_token = j.token || user.token || '';
    this.ttxc_charge_level = user.chargeLevel || {};
    if (!this.ttxc_user_id || !this.ttxc_token) { this.log('通通乡村: 登录响应缺少 userId/token'); return false; }
    this.log(`通通乡村: 登录成功，碳能量${this.ttxc_charge_level.carbonNum || 0}g，生态值${this.ttxc_charge_level.ecologyAmount || 0}`, true);
    return true;
  }
  async ttxcInitTtGame() {
    const url = `${TTXC_APP_BASE}/v1/login/ttGame?channel=${TTXC_CHANNEL}&rptId=`;
    let last = {};
    for (let i=1;i<=3;i++) {
      let j = parseJson((await this.request('post', url, {json:{unicomTokenId:this.unicomTokenId}, headers:this.ttxcHeaders(false, true)}))?.body) || {};
      last = j;
      if (j.code === '0000') return true;
      if (j.code === '4003' && j.data) {
        const done = await this.ttxcFinishWoauth(j.data);
        if (!done) this.log('通通乡村: woauth授权未完成');
        if (done) {
          j = parseJson((await this.request('post', url, {json:{unicomTokenId:this.unicomTokenId}, headers:this.ttxcHeaders(false, true)}))?.body) || {};
          last = j;
          if (j.code === '0000') return true;
        }
      }
      if (i < 3) await wait(2000);
    }
    this.log(`通通乡村: 初始化失败[${last.code ?? '?'}]: ${last.msg || ''}`);
    return false;
  }
  async ttxcFinishWoauth(loginUrl) {
    let token = extractWoauthToken(loginUrl);
    let current = loginUrl;
    let referer = 'https://epay.10010.com/';
    let lastStatus = '?';
    let lastBody = '';
    for (let i=0; !token && i<6; i++) {
      const r = await this.request('get', current, {headers:this.woauthHeaders(referer), followRedirect:false});
      lastStatus = r?.status || '?';
      lastBody = String(r?.body || '');
      const loc = r?.headers?.Location || r?.headers?.location || '';
      token = extractWoauthToken(current) || extractWoauthToken(loc) || extractWoauthToken(r?.body || '');
      if (token) break;
      if (!loc) break;
      referer = current;
      current = absolutize(current, loc);
    }
    if (!token) {
      if (String(lastStatus) === '200') {
        // 官方 woauth 链路有时最终落到通通乡村 H5 页面，页面内不再暴露 token，
        // 但服务端 Cookie/会话已写入；后续初始化可成功，不能按错误输出误导日志。
        return true;
      }
      this.log(`通通乡村: woauth未取到token[${lastStatus}]`);
      return false;
    }
    let next = `https://epay.10010.com/woauth2/after-collected-device-digest?deviceDigestTraceId=&deviceDigestTokenId=&token=${encodeURIComponent(token)}&source=app_sjyyt`;
    referer = current;
    for (let i=0;i<6;i++) {
      const rr = await this.request('get', next, {headers:this.woauthHeaders(referer), followRedirect:false});
      const loc = rr?.headers?.Location || rr?.headers?.location || '';
      if (!loc) { if (rr?.status !== 200) this.log(`通通乡村: woauth结束状态异常[${rr?.status || '?'}]`); return rr?.status === 200; }
      referer = next; next = absolutize(next, loc);
    }
    return false;
  }
  woauthHeaders(referer) {
    return {
      'User-Agent': H5_UA,
      Referer: referer || 'https://epay.10010.com/',
      Origin: 'https://epay.10010.com',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'X-Requested-With': 'com.sinovatech.unicom.ui',
      Cookie: this.cookieHeader(this.ecs_token ? `ecs_token=${this.ecs_token}` : '')
    };
  }
  async ttxcSign(query=false) {
    const info = await this.ttxcPost('/client/v1/sign/info', {});
    const code = info.data?.signinCode;
    if (!code) return this.log('通通乡村: 获取签到码失败');
    const user = await this.ttxcPost('/client/v1/sign/user', {code});
    const signed = String(user.data?.lastSigninTime || '').slice(0,10) === dateYmd();
    if (signed) return this.log('通通乡村: 今日已签到', true);
    if (query) return this.log('通通乡村: 今日未签到', true);
    const j = await this.ttxcPost('/client/v1/sign/signIn', {code});
    this.log(j.code === 0 ? '通通乡村: 签到成功' : `通通乡村: 签到失败[${j.code ?? '?'}]: ${j.msg || ''}`, j.code === 0);
  }
  async ttxcGetTasks() {
    const j = await this.ttxcPost('/client/v1/task/list', {});
    if (j.code !== 0) { this.log(`通通乡村: 获取任务列表失败[${j.code ?? '?'}]: ${j.msg || ''}`); return []; }
    const list = [];
    for (const g of (j.data || [])) for (const t of (g.taskList || [])) list.push({...t, taskGroupName:g.taskGroupName || ''});
    this.log(`通通乡村: 查询到 ${list.length} 个任务`);
    return list;
  }
  async ttxcClaimReadyTasks(tasks) { for (const t of tasks) if (t.taskStatus === 'UNCLA') { await this.ttxcFinishTask(t); await wait(800); } }
  async ttxcDoJumpTasks(tasks) { for (const t of tasks) if (t.taskType === 'GAME' && t.taskStatus === 'UNDO' && t.jumpUrl) { await this.ttxcDoTask(t); await wait(1000); } }
  async ttxcDoTask(t) { const id = t.taskCode || t.taskId || t.id; const j = await this.ttxcPost('/client/v1/task/do', {taskId:id}); this.log(j.code === 0 ? `通通乡村: 已执行[${t.taskTitle || id}]` : `通通乡村: 执行[${t.taskTitle || id}]失败[${j.code ?? '?'}]: ${j.msg || ''}`); }
  async ttxcFinishTask(t) { const id = t.taskCode || t.taskId || t.id; const j = await this.ttxcPost('/client/v1/task/finish', {taskId:id}); this.log(j.code === 0 ? `通通乡村: 领取[${t.taskTitle || id}]成功 +${t.carbonEnergyAmount || 0}g` : `通通乡村: 领取[${t.taskTitle || id}]失败[${j.code ?? '?'}]: ${j.msg || ''}`); }
  async ttxcDoGarbageTask(tasks) { const t = tasks.find(x => x.taskType === 'GAME' && x.taskStatus === 'UNDO' && String(x.taskTitle || '').includes('垃圾分类')); if (!t) return; this.log('通通乡村: 垃圾分类需真实答题流程，已跳过避免用户答题异常'); }

  marketHeaders(token, h5=false) { return {Authorization:`Bearer ${String(token || '').replace(/^Bearer\s+/i,'')}`, 'User-Agent':h5 ? H5_UA : UA, Origin:'https://contact.bol.wo.cn', Referer:'https://contact.bol.wo.cn/', 'Content-Type':'application/json', Accept:'*/*', 'X-Requested-With':'com.sinovatech.unicom.ui'}; }
  async marketTask(query=false) {
    this.log('==== 权益超市 ====');
    const ticket = (await this.openPlatLineNew('https://contact.bol.wo.cn/market'))?.ticket;
    if (!ticket) return this.log('权益超市: 获取ticket失败');
    const token = await this.marketGetUserToken(ticket);
    if (!token) return this.log('权益超市: 获取userToken失败');
    if (query) return await this.marketWateringStatus(token);
    await this.marketWateringTask(token); await wait(1000);
    await this.marketDoTasks(token); await wait(1000);
    await this.marketPrizeList(token); await this.marketDoRaffle(token);
  }
  async marketGetUserToken(ticket) { for (let i=1;i<=3;i++) { const j = parseJson((await this.request('post', `https://backward.bol.wo.cn/prod-api/auth/marketUnicomLogin?ticket=${encodeURIComponent(ticket)}`, {headers:{'User-Agent':UA}}))?.body) || {}; if (j.code === 200 && j.data?.token) return j.data.token; if (i<3) await wait(1500); } return ''; }
  async marketWateringStatus(token) { const j = parseJson((await this.request('get', 'https://backward.bol.wo.cn/prod-api/promotion/activityTask/getMultiCycleProcess?activityId=13', {headers:this.marketHeaders(token)}))?.body) || {}; if (j.code === 200) this.log(`权益超市-浇花当前状况: 进度 ${j.data?.triggeredTime || 0}/${j.data?.triggerTime || 0}`, true); else this.log(`权益超市-浇花查验: 查询状态失败: ${j.msg || responseSummary(j)}`); }
  async marketWateringTask(userToken) { const token=String(userToken).replace(/^Bearer\s+/i,''); const statusUrl='https://backward.bol.wo.cn/prod-api/promotion/activityTask/getMultiCycleProcess?activityId=13'; const st=parseJson((await this.request('get', statusUrl, {headers:this.marketHeaders(token)}))?.body)||{}; if(st.code!==200) return this.log(`权益超市-浇花: 获取状态失败: ${st.msg || responseSummary(st)}`); const d=st.data||{}, before=Number(d.triggeredTime||0), need=Number(d.triggerTime||0); if(String(d.createDate||'').slice(0,10)===dateYmd()) return this.log(`权益超市-浇花: 今日已浇水 (${before}/${need})`, true); if(before>=need) return this.log(`权益超市-浇花: 已达领奖条件 (${before}/${need})`, true); const loginId=parseJwt(token).loginId||''; if(!loginId) return this.log('权益超市-浇花: 无法获取登录标识'); const x='Y1mN8fNYktY0', ts=String(Date.now()), q=`xbsosjl=${x}&timeVerRan=${ts}&diceid=${loginId}`; const sig=await hmacSha256Base64(String(loginId), `td:433:tp${x}td:334:et${loginId}td:334:et${ts}td:334:et`); const h={Authorization:`Bearer ${token}`,'X-Signature':sig,'User-Agent':H5_UA,'Content-Type':'application/json',Origin:'https://contact.bol.wo.cn',Referer:'https://contact.bol.wo.cn/','X-Requested-With':'com.sinovatech.unicom.ui',Accept:'*/*'}; const j=parseJson((await this.request('post', `https://backward.bol.wo.cn/prod-api/promotion/activityTaskShare/checkWatering?${q}`, {body:'{}', headers:h}))?.body)||{}; if(j.code!==200) return this.log(`权益超市-浇花: 失败: ${j.msg || responseSummary(j)}`); await wait(1000); const ck=parseJson((await this.request('get', statusUrl, {headers:this.marketHeaders(token)}))?.body)||{}; const after=Number(ck.data?.triggeredTime ?? before); this.log(after!==before ? `权益超市-浇花: 浇水成功 (${before}/${need} → ${after}/${need})` : `权益超市-浇花: 浇水成功 (当前进度约 ${before}/${need}，APP可能稍后刷新)`, true); }
  async marketDoTasks(token) { const j=parseJson((await this.request('get','https://backward.bol.wo.cn/prod-api/promotion/activityTask/getAllActivityTasks?activityId=12',{headers:{...this.marketHeaders(token), Cookie:`ecs_token=${this.ecs_token}`}}))?.body)||{}; const list=j.data?.activityTaskUserDetailVOList||[]; this.log(`权益超市: 成功获取到 ${list.length} 个任务`); for(const t of list){ const name=t.name||'', done=Number(t.triggeredTime||0)>=Number(t.triggerTime||0); if(done||/购买|秒杀/.test(name)) continue; const key=t.param1||''; let url=''; if(/浏览|查看/.test(name)) url=`https://backward.bol.wo.cn/prod-api/promotion/activityTaskShare/checkView?checkKey=${encodeURIComponent(key)}`; if(/分享/.test(name)) url=`https://backward.bol.wo.cn/prod-api/promotion/activityTaskShare/checkShare?checkKey=${encodeURIComponent(key)}`; if(!url) continue; const r=parseJson((await this.request('post',url,{body:'{}',headers:this.marketHeaders(token,true)}))?.body)||{}; this.log(`权益超市: ${name}: ${r.code===200?'成功':'失败'}`); await wait(800); } }
  async marketPrizeList(token) { const ts=Date.now(), q=`id=12&timeVerRan=${ts}`; const sig=await marketSignature(token,q,'{}'); const j=parseJson((await this.request('post',`https://backward.bol.wo.cn/prod-api/promotion/home/raffleActivity/prizeList?${q}`,{body:'{}',headers:{...this.marketHeaders(token),...sig,Referer:'https://contact.bol.wo.cn/market'}}))?.body)||{}; const hot=(j.data||[]).filter(p=>/月卡|月会员|月度|VIP月|一个月|周卡/.test(p.name||'')&&!/5G宽视界|沃视频/.test(p.name||'')&&Number(p.dailyPrizeLimit||0)>0); if(hot.length) this.log(`权益超市: 奖池监测到 ${hot.length} 个高价值奖品`, true); }
  async marketDoRaffle(token) { const ts=Date.now(), q=`id=12&channel=unicomTab&timeVerRan=${ts}`; const sig=await marketSignature(token,q,'{}'); const c=parseJson((await this.request('post',`https://backward.bol.wo.cn/prod-api/promotion/home/raffleActivity/getUserRaffleCountExt?${q}`,{body:'{}',headers:{...this.marketHeaders(token),...sig,Referer:'https://contact.bol.wo.cn/market'}}))?.body)||{}; let n=Number((typeof c.data==='object'?c.data?.raffleCount:c.data)||0); if(n<=0) return this.log('权益超市: 当前无抽奖次数'); this.log(`权益超市: 当前抽奖次数: ${n}`); while(n-->0){ const q2=`id=12&channel=unicomTab&timeVerRan=${Date.now()}`, sig2=await marketSignature(token,q2,'{}'); const j=parseJson((await this.request('post',`https://backward.bol.wo.cn/prod-api/promotion/home/raffleActivity/userRaffle?${q2}`,{body:'{}',headers:{...this.marketHeaders(token),...sig2,Referer:'https://contact.bol.wo.cn/market'}}))?.body)||{}; this.log(`权益超市: 抽奖: ${j.data?.prizesName || j.data?.message || j.msg || responseSummary(j)}`, true); await wait(2500); } }

  async getTicketByNative(appId) { const j=parseJson((await this.request('get',`https://m.client.10010.com/edop_ng/getTicketByNative?token=${encodeURIComponent(this.ecs_token)}&appId=${encodeURIComponent(appId)}`,{headers:{'User-Agent':UA}}))?.body)||{}; return j.ticket || ''; }
  async securityTask(query=false) { this.log('==== 安全管家 ===='); const ticket=await this.getTicketByNative('edop_unicom_3a6cc75a'); if(!ticket) return this.log('安全管家: 获取ticket失败'); const j=parseJson((await this.request('post','https://m.jf.10010.com/jf-external-application/jftask/taskDetail',{json:{},headers:{'User-Agent':UA,'Content-Type':'application/json'}}))?.body)||{}; const list=j.data?.taskDetail?.taskList||[]; this.log(`安全管家: 任务列表 ${list.length} 个`); }
  async cloudDiskTask(query=false) { this.log('==== 联通云盘 ===='); const ticket=await this.getTicketByNative('edop_unicom_d67b3e30'); if(!ticket) return this.log('联通云盘: 获取ticket失败'); const token=await cloudDispatcherToken(ticket); if(!token) return this.log('联通云盘: 获取userToken失败'); const j=parseJson((await this.request('get','https://panservice.mail.wo.cn/activity/lottery/lottery-times?activityId=Mjc=',{headers:{Authorization:token,'User-Agent':UA}}))?.body)||{}; this.log(`联通云盘: 测速抽奖次数 ${Number(j.data?.times ?? j.data?.lotteryTimes ?? 0)}`); }
  async wostoreTask(query=false) {
    this.log('==== 沃云手机 ====');
    const entry=await this.openPlatLineNew('https://h5forphone.wostore.cn/cloudPhone/dialogCloudPhone.html?channel_id=ST-Zujian001-gs&cp_id=91002997');
    if(!entry?.ticket) return this.log(`沃云手机: 获取入口Ticket失败${entry?.location ? ' loc='+entry.location.slice(0,120) : ''}`);
    const tok=await wostoreLogin(entry.ticket);
    if(!tok?.access_token) return this.log(`沃云手机: 官方登录失败: ${tok?.message || tok?.msg || responseSummary(tok)}`);
    this.log(`沃云手机: 官方cloudphone登录成功${tok.userName ? '，用户 '+mask(tok.userName) : ''}`, true);
    if (tok.instanceChecked) this.log(`沃云手机: 实例状态: ${tok.instanceMsg || '已查询'}`, true);
    else this.log(`沃云手机: 实例状态查询失败: ${tok.instanceMsg || '接口未返回'}`);
  }
  async aitingTask(query=false) { this.log('==== 联通爱听 ===='); const appIds=['edop_unicom_a2','edop_unicom_aiting','edop_unicom_a']; for (const appId of appIds) { const ticket=await this.getTicketByNative(appId); if(ticket) { this.log(`联通爱听: 已获取ticket appId=${appId}，活动接口待继续接入`, true); return; } await wait(300); } this.log('联通爱听: 获取ticket失败，候选 appId 均不可用'); }
  async regionalTask(query=false) { this.log('==== 区域专区 ===='); const ps=(this.city_info||[]).map(x=>x.proName||'').filter(Boolean).join('/'); this.log(`区域专区: 当前省份 ${ps || '未识别'}`); }
}

function pickParam(s,k){ try { const m = String(s||'').match(new RegExp(`(?:[?&#]|^)${k}=([^&#&\\s]+)`)); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } }
function pickCookie(c,k){ const m = String(c||'').match(new RegExp(`${k}=([^;]+)`)); return m ? m[1] : ''; }
function readBool(k,d){ const v=$.getdata(k); return v==null||v===''?d:!['0','false','False','FALSE'].includes(v); }
function enabledSummary(){
  return [
    ['签到', ENABLE_SIGN], ['联通祝福', ENABLE_LTZF], ['天天领现金', ENABLE_TTLXJ], ['通通乡村', ENABLE_TTXC],
    ['权益超市', ENABLE_MARKET], ['阅读', ENABLE_WOREAD], ['爱听', ENABLE_AITING], ['安全管家', ENABLE_SECURITY],
    ['云盘', ENABLE_LTYP], ['沃云手机', ENABLE_WOSTORE], ['区域', ENABLE_REGIONAL]
  ].map(([n,v]) => `${n}:${v}`).join(' ');
}
function mask(s){ s=String(s||''); if(/^1\d{10}$/.test(s)) return s.slice(0,3)+'****'+s.slice(7); return s.length>12 ? s.slice(0,6)+'******'+s.slice(-6) : s; }
function oneLine(s){ return String(s || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); }
function formatError(e){ return (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e); }
function randomString(n, chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'){ let r=''; for(let i=0;i<n;i++) r+=chars[Math.floor(Math.random()*chars.length)]; return r; }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function time(){ const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }
function parseJson(s){ try { return typeof s === 'object' ? s : JSON.parse(s || '{}'); } catch { return null; } }
function parseCookieString(s){ const out={}; String(s||'').split(';').forEach(p=>{ const i=p.indexOf('='); if(i>0){ const k=p.slice(0,i).trim(); if(k) out[k]=p.slice(i+1).trim(); } }); return out; }
function parseSetCookie(s){ const out={}; if(!s) return out; const arr = Array.isArray(s) ? s : String(s).split(/,(?=\s*[^;,]+=)/); for (const c of arr) { const first = String(c).split(';')[0]; const i = first.indexOf('='); if (i > 0) out[first.slice(0,i).trim()] = first.slice(i+1).trim(); } return out; }
function serializeCookies(obj){ return Object.entries(obj || {}).filter(([k,v])=>k && v != null && v !== '').map(([k,v])=>`${k}=${v}`).join('; '); }
function responseSummary(j){ if(!j || typeof j !== 'object') return String(j || '接口返回异常'); return j.message || j.msg || j.desc || j.resultMsg || j.rsp_desc || '接口返回异常'; }
function dateYmd(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function absolutize(base, next){ if(/^https?:\/\//i.test(next)) return next; try{ const u=new URL(base); return next.startsWith('/') ? `${u.protocol}//${u.host}${next}` : `${u.protocol}//${u.host}${u.pathname.split('/').slice(0,-1).join('/')}/${next}`; }catch{return next;} }
function extractWoauthToken(s){
  s = String(s || '');
  const patterns = [
    /var\s+token\s*=\s*['"]([^'"]+)['"]/i,
    /[?&]token=([^&#\s]+)/i,
    /['"]token['"]\s*[:=]\s*['"]([^'"]+)['"]/i,
    /token\s*[:=]\s*['"]([^'"]+)['"]/i
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  }
  return '';
}
function woauthPageHint(s){
  s = String(s || '');
  if (!s) return '空响应';
  const marks = [];
  if (/token/i.test(s)) marks.push('含token字样');
  if (/error|失败|异常|invalid|unauthorized/i.test(s)) marks.push('错误页');
  if (/滑块|captcha|验证|verify|risk|风控/i.test(s)) marks.push('验证页');
  if (/success|成功|授权/i.test(s)) marks.push('授权页');
  const title = (s.match(/<title[^>]*>([^<]{1,40})<\/title>/i) || [,''])[1].trim();
  return `${marks.join('/') || '未知页'}${title ? ` title=${title}` : ''} len=${s.length}`;
}
function parseJwt(token){ try{ const p=String(token||'').split('.')[1]||''; return JSON.parse(base64UrlDecode(p)||'{}'); }catch{return {};} }
function base64UrlDecode(s){ s=String(s||'').replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; if(typeof atob!=='undefined') return decodeURIComponent(escape(atob(s))); if(typeof Buffer!=='undefined') return Buffer.from(s,'base64').toString('utf8'); return ''; }
function bytesToBase64(bytes){ let bin=''; for(const b of bytes) bin+=String.fromCharCode(b); if(typeof btoa!=='undefined') return btoa(bin); if(typeof Buffer!=='undefined') return Buffer.from(bin,'binary').toString('base64'); return ''; }
function strToBytes(s){ return Array.from(unescape(encodeURIComponent(String(s))), c=>c.charCodeAt(0)); }
async function hmacSha256Base64(key, message){
  if (typeof crypto!=='undefined' && crypto.subtle && typeof TextEncoder!=='undefined') {
    const enc=new TextEncoder();
    const ck=await crypto.subtle.importKey('raw', enc.encode(String(key)), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
    const sig=await crypto.subtle.sign('HMAC', ck, enc.encode(String(message)));
    return bytesToBase64(new Uint8Array(sig));
  }
  if (typeof $crypto!=='undefined' && $crypto.hmac) return $crypto.hmac('sha256', String(message), String(key), 'base64');
  return bytesToBase64(hmacSha256Bytes(strToBytes(String(key)), strToBytes(String(message))));
}
async function marketSignature(userToken, queryString='', jsonBody=''){
  const token=String(userToken||'').replace(/^Bearer\s+/i,'');
  const loginId=parseJwt(token).loginId || '';
  if(!loginId) return {};
  const appSecret = md5(`al:ak:${loginId}`);
  const nonce = uuidv4();
  const msg = `${loginId}${appSecret}${nonce}${queryString || ''}${jsonBody || ''}`;
  const sig=await hmacSha256Base64(appSecret, msg);
  return sig ? {'X-User-Id':loginId,'X-Nonce':nonce,'X-Timestamp':String(Date.now()),'X-Signature':sig,'Content-Type':'application/json'} : {};
}
async function cloudDispatcherToken(ticket){
  const timestamp=String(Date.now()), reqSeq=String(Math.floor(123456+Math.random()*76543));
  const body={header:{key:'HandheldHallAutoLoginV2',resTime:timestamp,reqSeq,channel:'wohome',version:'',sign:md5(`HandheldHallAutoLoginV2${timestamp}${reqSeq}wohome`)},body:{clientId:'1001000003',ticket}};
  const r=await http('post','https://panservice.mail.wo.cn/wohome/dispatcher',{json:body,headers:{'User-Agent':'Dalvik/2.1.0 (Linux; U; Android 12);unicom{version:android@11.0702}'}});
  const j=parseJson(r?.body)||{}; return j.RSP?.DATA?.token || '';
}
async function wostoreLogin(ticket){
  const common={cpId:'91002997',channelId:'ST-Zujian001-gs',ticket,env:'prod'};
  const h5Headers={Origin:'https://h5forphone.wostore.cn',Referer:'https://h5forphone.wostore.cn/cloudPhone/dialogCloudPhone.html?channel_id=ST-Zujian001-gs&cp_id=91002997','Content-Type':'application/json','User-Agent':H5_UA};
  await http('post','https://member.zlhz.wostore.cn/wcy_member/yunPhone/preCheck',{json:common,headers:h5Headers}).catch(()=>null);
  const s1=parseJson((await http('post','https://member.zlhz.wostore.cn/wcy_member/yunPhone/h5Awake/businessHall',{json:{...common,transId:'',qkActId:''},headers:h5Headers}))?.body)||{};
  const data=s1.data || {};
  const url=String(data.url || '');
  const accessToken=data.token || (url.match(/[?&]token=([^&]+)/)||[,''])[1] || '';
  if(!accessToken) return {message:s1.msg || s1.message || responseSummary(s1)};
  const token=decodeURIComponent(accessToken);
  const apiHeaders={Authorization:token,channelCode:'bucp-master',channel:'bucp-master',os:'H5',source:'4',deviceId:md5(token).slice(0,32),'User-Agent':H5_UA,Origin:'https://uphone.wo-adv.cn',Referer:`https://uphone.wo-adv.cn/cloudphone/?token=${encodeURIComponent(token)}&channelId=bucp-master`};
  const user=parseJson((await http('get','https://uphone.wo-adv.cn/bucp/servers/system/user/getAppUserInfo',{headers:apiHeaders}))?.body)||{};
  if (String(user.code || user.status) === '401') return {access_token:token,message:user.msg || user.message || responseSummary(user)};
  const ins=parseJson((await http('get','https://uphone.wo-adv.cn/bucp/servers/order/trade/checkUserInstance?channelCode=bucp-master',{headers:apiHeaders}))?.body)||{};
  const ok=/^(0|200|0000)$/.test(String(ins.code ?? ins.status ?? '')) || !!ins.data;
  return {access_token:token,userName:user.data?.phone || user.data?.mobile || user.data?.userName || '', instanceChecked:ok, instanceMsg:ins.msg || ins.message || (ok ? '已查询' : responseSummary(ins))};
}
function uuidv4(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);}); }
function hmacSha256Bytes(keyBytes,msgBytes){ const block=64; let key=keyBytes.slice(); if(key.length>block) key=sha256Bytes(key); if(key.length<block) key=key.concat(new Array(block-key.length).fill(0)); const o=new Array(block), i=new Array(block); for(let k=0;k<block;k++){ o[k]=key[k]^0x5c; i[k]=key[k]^0x36; } return sha256Bytes(o.concat(sha256Bytes(i.concat(msgBytes)))); }
function sha256Bytes(bytes){ const K=[1116352408,1899447441,-1245643825,-373957723,961987163,1508970993,-1841331548,-1424204075,-670586216,310598401,607225278,1426881987,1925078388,-2132889090,-1680079193,-1046744716,-459576895,-272742522,264347078,604807628,770255983,1249150122,1555081692,1996064986,-1740746414,-1473132947,-1341970488,-1084653625,-958395405,-710438585,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,-2117940946,-1838011259,-1564481375,-1474664885,-1035236496,-949202525,-778901479,-694614492,-200395387,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,-2067236844,-1933114872,-1866530822,-1538233109,-1090935817,-965641998]; const H=[1779033703,-1150833019,1013904242,-1521486534,1359893119,-1694144372,528734635,1541459225]; const l=bytes.length, bitLenHi=(l/0x20000000)|0, bitLenLo=(l<<3)>>>0, m=bytes.slice(); m.push(0x80); while((m.length%64)!==56)m.push(0); m.push((bitLenHi>>>24)&255,(bitLenHi>>>16)&255,(bitLenHi>>>8)&255,bitLenHi&255,(bitLenLo>>>24)&255,(bitLenLo>>>16)&255,(bitLenLo>>>8)&255,bitLenLo&255); const w=new Array(64); for(let off=0;off<m.length;off+=64){ for(let t=0;t<16;t++){ const p=off+t*4; w[t]=((m[p]<<24)|(m[p+1]<<16)|(m[p+2]<<8)|m[p+3])|0; } for(let t=16;t<64;t++){ const s0=rotr(w[t-15],7)^rotr(w[t-15],18)^(w[t-15]>>>3), s1=rotr(w[t-2],17)^rotr(w[t-2],19)^(w[t-2]>>>10); w[t]=(((w[t-16]+s0)|0)+((w[t-7]+s1)|0))|0; } let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7]; for(let t=0;t<64;t++){ const S1=rotr(e,6)^rotr(e,11)^rotr(e,25), ch=(e&f)^(~e&g), temp1=(((((h+S1)|0)+ch)|0)+K[t]+w[t])|0, S0=rotr(a,2)^rotr(a,13)^rotr(a,22), maj=(a&b)^(a&c)^(b&c), temp2=(S0+maj)|0; h=g;g=f;f=e;e=(d+temp1)|0;d=c;c=b;b=a;a=(temp1+temp2)|0; } H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0; } const out=[]; for(const v of H) out.push((v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255); return out; }
function rotr(x,n){ return (x>>>n)|(x<<(32-n)); }
function md5(str){
  function cmn(q,a,b,x,s,t){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b)}
  function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t)} function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t)} function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t)} function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t)}
  function md5cycle(x,k){let a=x[0],b=x[1],c=x[2],d=x[3];a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3])}
  function md5blk(s){let a=[];for(let i=0;i<64;i+=4)a[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return a}
  function md51(s){s=unescape(encodeURIComponent(String(s)));let n=s.length,state=[1732584193,-271733879,-1732584194,271733878],i;for(i=64;i<=n;i+=64)md5cycle(state,md5blk(s.substring(i-64,i)));s=s.substring(i-64);let tail=Array(16).fill(0);for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);tail=Array(16).fill(0)}tail[14]=n*8;md5cycle(state,tail);return state}
  function rhex(n){let s='0123456789abcdef',j,o='';for(j=0;j<4;j++)o+=s[(n>>(j*8+4))&15]+s[(n>>(j*8))&15];return o} function add32(a,b){return(a+b)&0xffffffff} return md51(str).map(rhex).join('');
}
function http(method, url, opts={}) { return new Promise((resolve,reject)=>{ const params = {...opts, url}; const followRedirect = opts.followRedirect; if (followRedirect === false) params['auto-redirect'] = false; delete params.followRedirect; if (opts.params) { const q = Object.entries(opts.params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); params.url += (params.url.includes('?')?'&':'?') + q; delete params.params; } if (opts.json) { params.body = JSON.stringify(opts.json); params.headers = {...(params.headers||{}), 'Content-Type':'application/json'}; delete params.json; } if (opts.form) { params.body = Object.entries(opts.form).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); params.headers = {...(params.headers||{}), 'Content-Type':'application/x-www-form-urlencoded'}; delete params.form; } const cb=(e,r,b)=> e ? reject(e) : resolve({status:r.status, headers:r.headers||{}, body:b}); method=method.toLowerCase(); $httpClient[method](params, cb); }); }
function finish(content){ $.log(content); $.msg('中国联通自动任务', '', content); $.done(); }
function Env(name){ return {name, log:(...a)=>console.log(...a), msg:(t,s,b)=>$notification.post(t,s,b), getdata:k=>$persistentStore.read(k), setdata:(v,k)=>$persistentStore.write(v,k), done:(v={})=>$done(v)} }
