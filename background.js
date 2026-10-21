// YT Transcript to Clipboard v1.0.0 — one-click copy, optional timestamp lines.
const TIMESTAMP_MENU = 'timestamp-toggle';
// UI follows Chrome's extension language (Japanese or English).
const message = (key, fallback, substitutions) =>
  chrome.i18n?.getMessage?.(key, substitutions) || fallback;

// Rebuild the icon's right-click menu on install/update and browser startup.
async function createSettingsMenu() {
  const { timestampsEnabled = false } = await chrome.storage.local.get('timestampsEnabled');
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: TIMESTAMP_MENU, title: message('timestampMenu', 'タイムスタンプ'), type: 'checkbox',
    contexts: ['action'], checked: timestampsEnabled
  });
}
chrome.runtime.onInstalled.addListener(createSettingsMenu);
chrome.runtime.onStartup.addListener(createSettingsMenu);
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === TIMESTAMP_MENU) {
    chrome.storage.local.set({ timestampsEnabled: info.checked === true });
  }
});
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const id = tab.id;
  const badge = async (text, color) => {
    await chrome.action.setBadgeBackgroundColor({ tabId: id, color });
    await chrome.action.setBadgeText({ tabId: id, text });
  };
  try {
    if (!/^https:\/\/(www\.|m\.)?youtube\.com\/(watch\?|shorts\/|live\/)/.test(tab.url || '')) {
      throw Error(message('invalidPage', 'YouTube の動画ページを開いてください'));
    }
    await badge('...', '#546e7a');
    const { timestampsEnabled = false } = await chrome.storage.local.get('timestampsEnabled');
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: id }, world: 'MAIN', func: collectTranscript,
      args: [timestampsEnabled]
    });
    if (!result || !result.text) {
      const origin = result?.error || '';
      throw Error(origin === '字幕の時刻情報を取得できませんでした'
        ? message('noTimestamp', origin)
        : origin === '字幕がありません、または YouTube 側の仕様で取得できません'
          ? message('noTranscript', origin)
          : origin === '動画IDを確認できません'
            ? message('videoIdError', origin)
            : origin || message('noTranscript', '字幕を取得できませんでした'));
    }
    const [{ result: copied }] = await chrome.scripting.executeScript({
      target: { tabId: id }, world: 'ISOLATED', func: copyText,
      args: [result.text]
    });
    if (!copied) throw Error(message('copyFailed', 'クリップボードへのコピーに失敗しました'));
    await badge('OK', '#197b4a');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id }, world: 'ISOLATED', func: showNotice,
        args: [message('copySuccess', `字幕をコピーしました（${result.text.length.toLocaleString()}文字）`, String(result.text.length.toLocaleString()))]
      });
    } catch { /* Copy succeeded, even if the tab navigated before the toast. */ }
  } catch (error) {
    await badge('ERR', '#ba2424');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id }, world: 'ISOLATED', func: showNotice,
        args: [`YT Transcript: ${error.message || String(error)}`]
      });
    } catch { /* Not an injectible page. The badge still reports the failure. */ }
    console.warn('YT Transcript to Clipboard:', error);
  }
});

// This function runs inside YouTube's MAIN world to read the live player data.
async function collectTranscript(withTimestamps = false) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const url = new URL(location.href);
  const videoId = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1];
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return { error: '動画IDを確認できません' };

  const player = document.querySelector('#movie_player');
  const response = [player?.getPlayerResponse?.(), window.ytInitialPlayerResponse]
    .find(r => r?.videoDetails?.videoId === videoId);
  // Produce a source header while preserving the original transcript text.
  function addVideoInfo(transcript) {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const details = response?.videoDetails;
    const metaUrl = document.querySelector('meta[property="og:url"]')?.content ||
      document.querySelector('link[rel="canonical"]')?.href || '';
    let matchingMetadata = false;
    try {
      const page = new URL(metaUrl);
      matchingMetadata = (page.searchParams.get('v') ||
        page.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1]) === videoId;
    } catch { /* No canonical metadata to verify. */ }

    const title = clean(details?.title ||
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string')?.textContent ||
      (matchingMetadata && document.querySelector('meta[property="og:title"]')?.content) ||
      document.title.replace(/\s*[-–]\s*YouTube\s*$/, ''));
    const channel = clean(details?.author ||
      document.querySelector('ytd-video-owner-renderer #channel-name a')?.textContent ||
      document.querySelector('#owner #channel-name a')?.textContent);

    // publishDate is not the same thing as uploadDate; don't mislabel it.
    const rawDate = response?.microformat?.playerMicroformatRenderer?.publishDate ||
      (matchingMetadata && document.querySelector('meta[itemprop="datePublished"]')?.content) || '';
    const published = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) &&
      !Number.isNaN(Date.parse(rawDate)) &&
      new Date(rawDate).toISOString().slice(0, 10) === rawDate ? rawDate : '';

    const header = [];
    if (title && title !== 'YouTube') header.push(`Title: ${title}`);
    if (channel) header.push(`Channel: ${channel}`);
    header.push(`URL: https://www.youtube.com/watch?v=${videoId}`);
    if (published) header.push(`Published: ${published}`);
    return `${header.join('\n')}\n---\nTranscript:\n${transcript}`;
  }
  const language = (navigator.language || 'en').toLowerCase().split('-')[0];
  const selectTrack = (tracks = []) => [...tracks].sort((a, b) => {
    const score = t => (t.languageCode?.toLowerCase() === language ? 4 :
      t.languageCode?.toLowerCase().startsWith(language + '-') ? 3 : 0) + (t.kind === 'asr' ? 0 : 1);
    return score(b) - score(a);
  })[0];

  // Keep real caption start times; do not estimate timestamps from text length.
  function formatTranscript(items) {
    const clean = items.map(({ text, ms }) => ({
      text: String(text || '').replace(/\s+/g, ' ').trim(), ms
    })).filter(item => item.text);
    const unique = clean.filter((item, i) => i === 0 || item.text !== clean[i - 1].text);
    if (!unique.length) return '';
    if (withTimestamps) {
      // A missing time makes this track unsuitable for timestamp mode.
      if (unique.some(item => !Number.isFinite(item.ms) || item.ms < 0)) return '';
      const clock = ms => {
        const seconds = Math.floor(ms / 1000);
        const pad = n => String(n).padStart(2, '0');
        const hh = Math.floor(seconds / 3600);
        const mm = Math.floor(seconds / 60) % 60;
        const ss = seconds % 60;
        return hh ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
      };
      return unique.map(item => `[${clock(item.ms)}] ${item.text}`).join('\n');
    }
    // Japanese words may be split mid-word by caption segmentation. Join those
    // without whitespace, but preserve a space between consecutive Latin words.
    let joined = '';
    for (const item of unique) {
      if (joined && /[A-Za-z0-9]$/.test(joined) && /^[A-Za-z0-9]/.test(item.text)) joined += ' ';
      joined += item.text;
    }
    // Break at sentence endings, not at arbitrary subtitle segment boundaries.
    return joined.replace(/([。！？!?]+[」』）】”’]?)[ \t]*/g, '$1\n').trim();
  }

  function parseCaptions(body) {
    if (!body.trim()) return '';
    let items = [];
    try {
      const data = JSON.parse(body);
      items = (data.events || []).map(event => ({
        text: (event.segs || []).map(seg => seg.utf8 || '').join(''),
        ms: Number.isFinite(event.tStartMs) ? event.tStartMs : null
      }));
    } catch {
      const xml = new DOMParser().parseFromString(body, 'text/xml');
      if (xml.querySelector('parsererror')) return '';
      items = [...xml.querySelectorAll('text, p')].map(node => {
        const start = node.getAttribute('start');  // XML <text start=seconds>
        const t = node.getAttribute('t');          // XML <p t=milliseconds>
        return {
          text: node.textContent || '',
          ms: start !== null && start !== '' && Number.isFinite(Number(start)) ? Number(start) * 1000 :
            t !== null && t !== '' && Number.isFinite(Number(t)) ? Number(t) : null
        };
      });
    }
    return formatTranscript(items);
  }

  async function readTrack(track) {
    if (!track?.baseUrl) return '';
    const trackUrl = new URL(track.baseUrl, location.origin);
    // Never fetch an arbitrary origin returned by page JavaScript.
    if (trackUrl.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(trackUrl.hostname)) return '';
    for (const fmt of ['json3', '']) {
      const candidate = new URL(trackUrl);
      if (fmt) candidate.searchParams.set('fmt', fmt);
      else candidate.searchParams.delete('fmt');
      try {
        const response = await fetch(candidate.toString(), { credentials: 'same-origin' });
        if (!response.ok) continue;
        const parsed = parseCaptions(await response.text());
        if (parsed) return parsed;
      } catch { /* Try the other subtitle format. */ }
    }
    return '';
  }

  // First try the player track; some YouTube WEB tracks now return empty bodies.
  let text = await readTrack(selectTrack(response?.captions?.playerCaptionsTracklistRenderer?.captionTracks));
  if (text) return { text: addVideoInfo(text) };

  // Second try YouTube's mobile-player caption track (often not PoToken-gated).
  const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
  const clients = [
    { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 33 },
    { clientName: 'IOS', clientVersion: '20.10.3', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '18.0' }
  ];
  for (const client of clients) {
    try {
      const endpoint = `/youtubei/v1/player${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
      const r = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': client.clientName === 'ANDROID' ? '3' : '5', 'X-YouTube-Client-Version': client.clientVersion },
        body: JSON.stringify({ videoId, context: { client: { ...client, hl: navigator.language || 'ja', gl: 'JP' } } })
      });
      if (!r.ok) continue;
      const data = await r.json();
      text = await readTrack(selectTrack(data.captions?.playerCaptionsTracklistRenderer?.captionTracks));
      if (text) return { text: addVideoInfo(text) };
    } catch { /* Try another client, then the native transcript panel. */ }
  }

  // Final fallback: open YouTube's transcript panel automatically (no manual step).
  const segmentSelector = 'ytd-transcript-segment-renderer .segment-text, ytd-transcript-segment-renderer yt-formatted-string.segment-text';
  let segments = [...document.querySelectorAll(segmentSelector)];
  if (!segments.length) {
    const expand = document.querySelector('ytd-watch-metadata #expand, ytd-text-inline-expander #expand');
    if (expand && !expand.closest('[hidden]')) expand.click();
    await sleep(300);
    const section = document.querySelector('ytd-video-description-transcript-section-renderer');
    const opener = section?.querySelector('button, [role="button"]') ||
      [...document.querySelectorAll('button, [role="button"]')].find(el =>
        /^(show transcript|文字起こしを表示|文字起こしを表示する)$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()));
    if (opener) opener.click();
    let previous = 0, stable = 0;
    for (let n = 0; n < 36; n++) {
      await sleep(250);
      segments = [...document.querySelectorAll(segmentSelector)];
      if (segments.length && segments.length === previous) stable++;
      else stable = 0;
      if (stable >= 3) break;
      previous = segments.length;
    }
  }
  const timeFromPanel = raw => {
    const match = String(raw || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hh = Number(match[1] || 0), mm = Number(match[2]), ss = Number(match[3]);
    if (mm >= 60 && match[1] || ss >= 60) return null;
    return ((hh * 60 + mm) * 60 + ss) * 1000;
  };
  const panelItems = segments.map(s => {
    const row = s.closest('ytd-transcript-segment-renderer');
    const offset = row?.querySelector('.segment-start-offset');
    return { text: s.innerText || s.textContent || '', ms: timeFromPanel(offset?.textContent) };
  });
  text = formatTranscript(panelItems);
  return text ? { text: addVideoInfo(text) } : {
    error: withTimestamps ? '字幕の時刻情報を取得できませんでした' : '字幕がありません、または YouTube 側の仕様で取得できません'
  };
}

// Runs in Chrome's isolated extension context with the clipboardWrite permission.
async function copyText(text) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // Fallback for browser builds that require a foreground document to copy.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    copied = document.execCommand('copy');
    area.remove();
  }
  return copied;
}

function showNotice(message) {
  document.querySelector('#jit-transcript-notice')?.remove();
  const notice = document.createElement('div');
  notice.id = 'jit-transcript-notice';
  notice.textContent = message;
  notice.style.cssText = 'position:fixed;z-index:2147483647;top:70px;right:18px;max-width:380px;padding:12px 16px;background:#202124;color:#fff;border-radius:8px;box-shadow:0 3px 15px #0006;font:14px sans-serif;pointer-events:none';
  document.body.append(notice);
  setTimeout(() => notice.remove(), 3500);
}
