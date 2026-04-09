(function () {
  'use strict';
  const isMobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  Cesium.Ion.defaultAccessToken = undefined;
  const creditSink = document.createElement('div');
  creditSink.style.display = 'none';
  document.body.appendChild(creditSink);

  let viewer;
  try {
    viewer = new Cesium.Viewer('cesiumContainer', {
      imageryProvider: new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 23,
        enablePickFeatures: false
      }),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, creditContainer: creditSink,
      scene3DOnly: true, requestRenderMode: false, useBrowserRecommendedResolution: false,
      contextOptions: {
        webgl: { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false },
        allowTextureFilterAnisotropic: true
      },
      msaaSamples: 1
    });
  } catch (e) {
    viewer = new Cesium.Viewer('cesiumContainer', {
      imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
        enablePickFeatures: false,
      }),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, creditContainer: creditSink,
      scene3DOnly: true, requestRenderMode: false, useBrowserRecommendedResolution: false,
      contextOptions: {
        webgl: { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false },
        allowTextureFilterAnisotropic: true
      },
      msaaSamples: 1
    });
  }


  const labelsLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 23,
  }));
  const cartoLabelsLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
    maximumLevel: 20,
    credit: 'CARTO / OpenStreetMap'
  }));
  const voyagerLabelsLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
    maximumLevel: 20,
    credit: 'CARTO / OpenStreetMap'
  }));
  const overlayLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 23,
  }));
  const baseLayer = viewer.imageryLayers.get(0);
  labelsLayer.alpha = 0.98;
  labelsLayer.brightness = 1.34;
  labelsLayer.contrast = 1.28;
  labelsLayer.gamma = 0.9;
  cartoLabelsLayer.alpha = 0.68;
  cartoLabelsLayer.brightness = 1.4;
  cartoLabelsLayer.contrast = 1.34;
  cartoLabelsLayer.gamma = 0.84;
  voyagerLabelsLayer.alpha = 0.58;
  voyagerLabelsLayer.brightness = 1.28;
  voyagerLabelsLayer.contrast = 1.22;
  voyagerLabelsLayer.gamma = 0.9;
  overlayLayer.alpha = 0.94;
  overlayLayer.brightness = 1.16;
  overlayLayer.contrast = 1.12;
  overlayLayer.gamma = 0.94;

  if (baseLayer) {
    baseLayer.brightness = 1.03;
    baseLayer.contrast = 1.1;
    baseLayer.gamma = 0.96;
    baseLayer.hue = 0.0;
    baseLayer.saturation = 1.04;
  }


  const scene = viewer.scene;
  const globe = scene.globe;
  scene.globe.show = true;
  scene.globe.enableLighting = false;
  scene.globe.depthTestAgainstTerrain = false;
  scene.globe.baseColor = Cesium.Color.BLACK;
  scene.fxaa = false;
  if (scene.postProcessStages && scene.postProcessStages.fxaa) scene.postProcessStages.fxaa.enabled = false;
  scene.skyAtmosphere.show = false;
  scene.fog.enabled = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.highDynamicRange = false;

  viewer.resolutionScale = isMobile ? 1 : Math.min((window.devicePixelRatio || 1) * 1.08, 1.7);
  viewer.targetFrameRate = isMobile ? 45 : 60;
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = Infinity;
  globe.maximumScreenSpaceError = isMobile ? 0.9 : 0.62;
  globe.tileCacheSize = isMobile ? 1600 : 4200;
  globe.preloadAncestors = true;
  globe.preloadSiblings = true;
  globe.loadingDescendantLimit = isMobile ? 96 : 140;
  globe.showGroundAtmosphere = false;
  scene.requestRender();
  scene.screenSpaceCameraController.inertiaSpin = isMobile ? 0.48 : 0.62;
  scene.screenSpaceCameraController.inertiaTranslate = isMobile ? 0.56 : 0.7;
  scene.screenSpaceCameraController.inertiaZoom = isMobile ? 0.5 : 0.64;
  scene.screenSpaceCameraController.maximumMovementRatio = isMobile ? 0.12 : 0.18;
  scene.screenSpaceCameraController.minimumZoomDistance = 250;
  scene.screenSpaceCameraController.maximumZoomDistance = 30000000;

  const HOME_VIEW = {
    destination: Cesium.Cartesian3.fromDegrees(127.5, 36.0, 18000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 }
  };

  viewer.camera.setView(HOME_VIEW);

  const ssc = scene.screenSpaceCameraController;
  ssc.tiltEventTypes = [];
  ssc.lookEventTypes = [];
  ssc.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);

  const loadEl = document.getElementById('loading');
  let dismissed = false;
  function dismissLoad() { if (dismissed) return; dismissed = true; loadEl.classList.add('out'); setTimeout(() => loadEl.classList.add('gone'), 800); }
  globe.tileLoadProgressEvent.addEventListener(n => { if (n === 0) dismissLoad(); });
  setTimeout(() => {
    const sub = document.querySelector('#loading .ld-t2');
    if (!dismissed && sub) sub.textContent = '지도 초기화 중...';
    dismissLoad();
  }, 4500);

  const ibLat = document.getElementById('ib-lat');
  const ibLon = document.getElementById('ib-lon');
  const ibAlt = document.getElementById('ib-alt');
  const ibZoom = document.getElementById('ib-zoom');
  const ziFill = document.getElementById('zi-fill');
  const ziVal = document.getElementById('zi-val');
  const lastCheck = document.getElementById('last-check');
  const MAX_Z = 19;
  let mouseEnd = null;

  function altToZ(m) {
    const z = Math.round(19 - Math.log2(Math.max(1, m) / 300));
    return Math.max(0, Math.min(MAX_Z, z));
  }
  function fmtAlt(m) {
    if (m >= 1e6) return (m / 1e6).toFixed(2) + ' Mm';
    if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
    return m.toFixed(0) + ' m';
  }
  function setLastCheck() {
    const now = new Date();
    lastCheck.textContent = now.toLocaleTimeString('ko-KR', { hour12: false });
  }
  setLastCheck();
  setInterval(setLastCheck, 15 * 60 * 1000);

  handler.setInputAction(function (movement) { mouseEnd = movement.endPosition; }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function () { scene.requestRender(); }, Cesium.ScreenSpaceEventType.WHEEL);
  handler.setInputAction(function () { scene.requestRender(); }, Cesium.ScreenSpaceEventType.PINCH_MOVE);
  handler.setInputAction(function () { scene.requestRender(); }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(function () { scene.requestRender(); }, Cesium.ScreenSpaceEventType.LEFT_UP);

  scene.postRender.addEventListener(() => {
    const cam = viewer.camera.positionCartographic;
    if (!cam) return;
    let targetCarto = null;
    if (mouseEnd) {
      const ray = viewer.camera.getPickRay(mouseEnd);
      const pick = ray ? scene.globe.pick(ray, scene) : null;
      if (pick) targetCarto = Cesium.Cartographic.fromCartesian(pick);
    }
    const src = targetCarto || cam;
    const lat = Cesium.Math.toDegrees(src.latitude);
    const lon = Cesium.Math.toDegrees(src.longitude);
    const z = altToZ(cam.height);
    labelsLayer.alpha = z >= 13 ? 1.0 : (z >= 10 ? 0.99 : 0.96);
    overlayLayer.alpha = z >= 12 ? 1.0 : 0.95;
    cartoLabelsLayer.alpha = z >= 14 ? 0.82 : (z >= 11 ? 0.72 : 0.56);
    voyagerLabelsLayer.alpha = z >= 14 ? 0.78 : (z >= 11 ? 0.66 : 0.5);
    ibLat.textContent = (lat >= 0 ? 'N ' : 'S ') + Math.abs(lat).toFixed(4) + '°';
    ibLon.textContent = (lon >= 0 ? 'E ' : 'W ') + Math.abs(lon).toFixed(4) + '°';
    ibAlt.textContent = fmtAlt(cam.height);
    if (ibZoom) ibZoom.textContent = 'Z' + z;
    ziVal.textContent = 'Z' + z;
    ziFill.style.height = Math.round((z / MAX_Z) * 100) + '%';
  });

  const globeHomeBtn = document.getElementById('globe-home');
  const btn = document.getElementById('srch-btn');
  const row = document.getElementById('search-row');
  const input = document.getElementById('srch-input');
  const clrBtn = document.getElementById('srch-clear');
  const spinner = document.getElementById('srch-spin');
  const results = document.getElementById('srch-results');
  let opened = false, timer = null, items = [], actIdx = -1;
  let lastSelectedText = '';

  function openPanel() {
    opened = true;
    row.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => setTimeout(() => input.focus(), 10));
  }
  function closePanel() {
    opened = false;
    row.classList.remove('open', 'has-results');
    btn.setAttribute('aria-expanded', 'false');
    results.style.display = 'none';
    items = []; actIdx = -1;
    spinner.style.display = 'none';
    btn.focus();
  }
  btn.addEventListener('click', function () { opened ? closePanel() : openPanel(); });
  input.addEventListener('input', function () {
    const q = input.value;
    clrBtn.style.display = q ? 'block' : 'none';
    clearTimeout(timer);
    if (!q.trim()) { clearResults(); return; }
    timer = setTimeout(() => doSearch(q.trim()), 320);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAct(actIdx + 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAct(actIdx - 1); }
    if (e.key === 'Enter') { e.preventDefault(); const i = actIdx >= 0 ? actIdx : 0; if (items[i]) flyTo(items[i]); }
  });
  clrBtn.addEventListener('click', function () { input.value = ''; clrBtn.style.display = 'none'; clearResults(); input.focus(); });
  document.addEventListener('click', function (e) { if (!document.getElementById('search-wrap').contains(e.target)) clearResults(); });

  globeHomeBtn.addEventListener('click', function () {
    viewer.camera.flyTo({
      ...HOME_VIEW,
      duration: 2.6,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT
    });
  });

  document.addEventListener('keydown', function (e) {
    if (document.activeElement === input) return;
    if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f')) { e.preventDefault(); if (!opened) openPanel(); else input.focus(); }
    if (e.key === 'h' || e.key === 'H') {
      viewer.camera.flyTo({ ...HOME_VIEW, duration: 2.2, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT });
    }
  });
  function clearResults() { results.style.display = 'none'; row.classList.remove('has-results'); items = []; actIdx = -1; }
  function msgBox(msg) { results.innerHTML = '<div class="r-msg">' + msg + '</div>'; results.style.display = 'block'; row.classList.add('has-results'); }
  function setAct(idx) {
    const els = results.querySelectorAll('.r-item');
    actIdx = Math.max(0, Math.min(els.length - 1, idx));
    els.forEach((el, i) => el.classList.toggle('act', i === actIdx));
    if (els[actIdx]) els[actIdx].scrollIntoView({ block: 'nearest' });
  }

  const ICONS = { country:'🌐', state:'📌', province:'📌', region:'📌', city:'🏙', town:'🏘', village:'🏠', suburb:'🏠', peak:'⛰', mountain:'⛰', volcano:'🌋', lake:'🏞', river:'💧', bay:'🌊', ocean:'🌊', island:'🏝', airport:'✈', station:'🚉', hospital:'🏥', university:'🎓', park:'🌿', forest:'🌲', beach:'🏖', museum:'🏛', building:'🏢', road:'🛣', default:'📍' };
  const ico = (t, c) => ICONS[t] || ICONS[c] || ICONS.default;

  const ISO_COUNTRY_CODES = [
    'AF','AL','DZ','AD','AO','AG','AR','AM','AU','AT','AZ','BS','BH','BD','BB','BY','BE','BZ','BJ','BT','BO','BA','BW','BR','BN','BG','BF','BI','CV','KH','CM','CA','CF','TD','CL','CN','CO','KM','CG','CD','CR','CI','HR','CU','CY','CZ','DK','DJ','DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FJ','FI','FR','GA','GM','GE','DE','GH','GR','GD','GT','GN','GW','GY','HT','HN','HU','IS','IN','ID','IR','IQ','IE','IL','IT','JM','JP','JO','KZ','KE','KI','KP','KR','KW','KG','LA','LV','LB','LS','LR','LY','LI','LT','LU','MG','MW','MY','MV','ML','MT','MH','MR','MU','MX','FM','MD','MC','MN','ME','MA','MZ','MM','NA','NR','NP','NL','NZ','NI','NE','NG','MK','NO','OM','PK','PW','PA','PG','PY','PE','PH','PL','PT','QA','RO','RU','RW','KN','LC','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SK','SI','SB','SO','ZA','SS','ES','LK','SD','SR','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TO','TT','TN','TR','TM','TV','UG','UA','AE','GB','US','UY','UZ','VU','VA','VE','VN','YE','ZM','ZW'
  ];
  const COUNTRY_NAME_TO_CODE = {};
  const COUNTRY_ALIASES = {};
  const countryDisplayKo = new Intl.DisplayNames(['ko'], { type: 'region' });
  const countryDisplayEn = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const code of ISO_COUNTRY_CODES) {
    const ko = countryDisplayKo.of(code);
    const en = countryDisplayEn.of(code);
    if (en) {
      COUNTRY_ALIASES[normalizeForSearch(en)] = en;
      COUNTRY_NAME_TO_CODE[normalizeForSearch(en)] = code.toLowerCase();
    }
    if (ko) {
      COUNTRY_ALIASES[normalizeForSearch(ko)] = en;
      COUNTRY_NAME_TO_CODE[normalizeForSearch(ko)] = code.toLowerCase();
    }
  }
  Object.assign(COUNTRY_ALIASES, {
    '대한민국': 'South Korea', '한국': 'South Korea', '남한': 'South Korea', 'korea republic': 'South Korea', 'republic of korea': 'South Korea',
    '조선민주주의인민공화국': 'North Korea', '북한': 'North Korea', 'democratic people s republic of korea': 'North Korea',
    '미국': 'United States', '미합중국': 'United States', 'usa': 'United States', 'us': 'United States', 'u s a': 'United States', 'u s': 'United States', 'united states of america': 'United States',
    '영국': 'United Kingdom', 'uk': 'United Kingdom', 'u k': 'United Kingdom', 'great britain': 'United Kingdom', 'britain': 'United Kingdom',
    'uae': 'United Arab Emirates', 'u a e': 'United Arab Emirates',
    '러시아': 'Russia', '러시아연방': 'Russia',
    '체코': 'Czechia', '체코공화국': 'Czechia',
    '대만': 'Taiwan', '타이완': 'Taiwan',
    '베트남': 'Vietnam', '홍콩': 'Hong Kong', '벨기에': 'Belgium', '브라질': 'Brazil', '독일': 'Germany', '프랑스': 'France', '이탈리아': 'Italy', '스페인': 'Spain', '일본': 'Japan', '중국': 'China', '호주': 'Australia', '캐나다': 'Canada'
  });
  Object.assign(COUNTRY_NAME_TO_CODE, {
    '대한민국': 'kr', '한국': 'kr', '남한': 'kr', '조선민주주의인민공화국': 'kp', '북한': 'kp',
    '미국': 'us', '미합중국': 'us', 'usa': 'us', 'us': 'us', 'u s': 'us', 'united states of america': 'us',
    '영국': 'gb', 'uk': 'gb', 'u k': 'gb', 'great britain': 'gb', 'britain': 'gb',
    'uae': 'ae', 'u a e': 'ae', '러시아': 'ru', '러시아연방': 'ru', '체코': 'cz', '체코공화국': 'cz', '대만': 'tw', '타이완': 'tw', '벨기에': 'be', '브라질': 'br', '독일': 'de', '프랑스': 'fr', '이탈리아': 'it', '스페인': 'es', '일본': 'jp', '중국': 'cn', '호주': 'au', '캐나다': 'ca'
  });

  const PLACE_ALIASES = {
    '서울': ['Seoul'], '서울특별시': ['Seoul'], '부산': ['Busan'], '대구': ['Daegu'], '인천': ['Incheon'],
    '대전': ['Daejeon'], '광주': ['Gwangju'], '울산': ['Ulsan'], '세종': ['Sejong'], '제주': ['Jeju'],
    '뉴욕': ['New York City', 'New York'], '뉴욕시': ['New York City'], '맨해튼': ['Manhattan'], '브뤼셀': ['Brussels', 'Bruxelles', 'Brussel'], '벨기에': ['Belgium'],
    '도쿄': ['Tokyo'], '오사카': ['Osaka'], '교토': ['Kyoto'], '런던': ['London'], '파리': ['Paris'], '로마': ['Rome'],
    '베를린': ['Berlin'], '마드리드': ['Madrid'], '암스테르담': ['Amsterdam'], '토론토': ['Toronto'], '시드니': ['Sydney']
  };

  function normalizeForSearch(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[–—-]/g, ' ')
      .replace(/[|/\\]+/g, ' ')
      .replace(/[()\[\]{}]/g, ' ')
      .replace(/[.'’]/g, '')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleCaseWords(value) {
    return String(value || '').split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function resolveCountryAlias(value) {
    const n = normalizeForSearch(value);
    return COUNTRY_ALIASES[n] || value;
  }

  function resolveCountryCode(value) {
    const n = normalizeForSearch(value);
    return COUNTRY_NAME_TO_CODE[n] || COUNTRY_NAME_TO_CODE[normalizeForSearch(resolveCountryAlias(value))] || '';
  }

  function resolvePlaceAliases(value) {
    const n = normalizeForSearch(value);
    const base = PLACE_ALIASES[n] || [value];
    return [...new Set(base.concat([value]).filter(Boolean))];
  }

  function parseSearchIntent(query) {
    const cleaned = String(query || '')
      .replace(/\s*[>]+\s*/g, ', ')
      .replace(/\s*[|]+\s*/g, ', ')
      .replace(/\s+-\s+/g, ', ')
      .trim();
    const parts = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    const result = { raw: cleaned, locality: '', country: '', countryCode: '', admin: '', mode: 'general' };

    const tryAssignCountry = (value) => {
      const resolved = resolveCountryAlias(value);
      const code = resolveCountryCode(value || resolved);
      if (code) {
        result.country = resolved;
        result.countryCode = code;
        return true;
      }
      return false;
    };

    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (tryAssignCountry(last)) {
        result.locality = parts.slice(0, -1).join(', ');
        if (parts.length > 2) result.admin = parts.slice(1, -1).join(', ');
      } else if (tryAssignCountry(first)) {
        result.locality = parts.slice(1).join(', ');
        if (parts.length > 2) result.admin = parts.slice(1, -1).join(', ');
      }
    }

    if (!result.country) {
      const tokens = cleaned.split(/[, ]+/).map(s => s.trim()).filter(Boolean);
      for (const token of tokens) {
        if (tryAssignCountry(token)) {
          result.locality = cleaned
            .replace(new RegExp(escapeRegExp(token), 'i'), '')
            .replace(/\s+,/g, ',')
            .replace(/^,|,$/g, '')
            .trim();
          break;
        }
      }
    }

    if (!result.locality) result.locality = cleaned;
    result.locality = result.locality.replace(/^,|,$/g, '').trim();

    const rawNormalized = normalizeForSearch(cleaned);
    const localityNormalized = normalizeForSearch(result.locality);
    const countryNormalized = normalizeForSearch(result.country);
    if (result.country && (!localityNormalized || localityNormalized === rawNormalized || localityNormalized === countryNormalized)) {
      result.locality = '';
      result.mode = 'country';
    } else if (result.country && result.locality) {
      result.mode = 'country-locality';
    } else if (result.locality) {
      result.mode = 'locality';
    }
    return result;
  }

  function buildQueryVariants(query, intent) {
    const { raw, locality, country } = intent;
    const variants = new Set();
    const localityAliases = locality ? resolvePlaceAliases(locality) : [raw];
    const rawNormalized = normalizeForSearch(raw);
    variants.add(raw);
    variants.add(rawNormalized);

    const localityParts = locality.split(',').map(v => v.trim()).filter(Boolean);
    for (const place of localityAliases) {
      const normalizedPlace = normalizeForSearch(place);
      variants.add(place);
      variants.add(titleCaseWords(normalizedPlace));
      variants.add(place.replace(/,/g, ' '));
      if (country) {
        variants.add(`${place}, ${country}`);
        variants.add(`${country}, ${place}`);
        variants.add(`${place} ${country}`);
        variants.add(`${country} ${place}`);
      }
      if (localityParts.length > 1) {
        variants.add(localityParts.join(', '));
        variants.add(localityParts.slice().reverse().join(', '));
        variants.add(localityParts.join(' '));
      }
    }

    if (country && locality && locality !== raw) variants.add(`${locality}, ${country}`);
    return [...variants].map(v => v.trim()).filter(Boolean).slice(0, 12);
  }

  function bestPrimaryName(item) {
    const addr = item.address || {};
    return addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state || addr.country || item.name || item.display_name.split(',')[0].trim();
  }

  function bestDisplayName(item) {
    const addr = item.address || {};
    return item.namedetails?.['name:ko'] || item.namedetails?.name || addr.city || addr.town || addr.village || addr.municipality || item.name || bestPrimaryName(item);
  }

  function scoreResult(item, intent, query) {
    const hay = normalizeForSearch([
      item.display_name,
      item.name,
      item.type,
      item.class,
      item.address?.city,
      item.address?.town,
      item.address?.village,
      item.address?.municipality,
      item.address?.county,
      item.address?.state,
      item.address?.country,
      item.namedetails?.name,
      item.namedetails?.['name:ko'],
      item.namedetails?.['name:en']
    ].filter(Boolean).join(' | '));
    const addr = item.address || {};
    const primary = normalizeForSearch(bestPrimaryName(item));
    const localityNeedles = (intent.mode === 'country' ? [] : resolvePlaceAliases(intent.locality || intent.raw).map(normalizeForSearch));
    const countryNeedle = normalizeForSearch(intent.country || '');
    let score = 0;

    for (const needle of localityNeedles) {
      if (!needle) continue;
      if (primary === needle) score += 190;
      if (hay.includes(needle)) score += 82;
      if ((addr.city && normalizeForSearch(addr.city) === needle) || (addr.town && normalizeForSearch(addr.town) === needle) || (addr.village && normalizeForSearch(addr.village) === needle) || (addr.municipality && normalizeForSearch(addr.municipality) === needle)) score += 145;
      if (normalizeForSearch(bestDisplayName(item)) === needle) score += 115;
    }
    if (countryNeedle) {
      if (normalizeForSearch(addr.country) === countryNeedle || primary === countryNeedle) score += 110;
      else if (hay.includes(countryNeedle)) score += 50;
      else score -= 80;
    }

    const type = item.type || '';
    const cls = item.class || '';
    if (['city', 'municipality'].includes(type)) score += 95;
    else if (['town', 'village', 'suburb', 'borough'].includes(type)) score += 82;
    else if (['county', 'state_district', 'province', 'region'].includes(type)) score += 20;
    else if (type === 'administrative') score += 24;
    else if (type === 'state') score -= 18;
    else if (type === 'country') score += intent.locality ? -70 : 95;

    if (intent.mode === 'country') {
      if (type === 'country' || cls === 'boundary') score += 220;
      if (normalizeForSearch(bestDisplayName(item)) === countryNeedle || primary === countryNeedle) score += 160;
      if (type === 'city' || type === 'town' || type === 'municipality' || type === 'village') score -= 220;
    }
    if (cls === 'place') score += 16;
    if (cls === 'boundary') score -= 18;

    const importance = Number(item.importance || 0);
    score += importance * 58;
    const placeRank = Number(item.place_rank || 0);
    score += Math.max(0, 34 - Math.abs(16 - placeRank));

    const bbox = Array.isArray(item.boundingbox) ? item.boundingbox.map(Number) : null;
    if (bbox && bbox.every(Number.isFinite)) {
      const latSpan = Math.abs(bbox[1] - bbox[0]);
      const lonSpan = Math.abs(bbox[3] - bbox[2]);
      const areaScore = Math.max(0, 28 - ((latSpan + lonSpan) * 18));
      score += areaScore;
      if ((type === 'city' || type === 'town' || type === 'municipality') && latSpan < 2.4 && lonSpan < 2.4) score += 28;
      if ((type === 'state' || type === 'country') && intent.locality) score -= 35;
    }

    const qNorm = normalizeForSearch(query);
    if (/new york/.test(qNorm)) {
      if (normalizeForSearch(addr.state) === 'new york' && normalizeForSearch(addr.country) === 'united states') score += 24;
      if (primary === 'new york city' || primary === 'new york' || normalizeForSearch(bestDisplayName(item)) === 'new york city') score += 95;
      if (type === 'state') score -= 95;
    }
    if (/brussels|bruxelles|brussel|브뤼셀/.test(query)) {
      if (normalizeForSearch(addr.country) === 'belgium') score += 55;
      if (primary === 'brussels' || primary === 'bruxelles' || primary === 'brussel') score += 90;
    }
    return score;
  }

  function typePriority(item) {
    const type = String(item?.type || '').toLowerCase();
    const cls = String(item?.class || '').toLowerCase();
    if (type === 'country') return 100;
    if (['city', 'municipality'].includes(type)) return 90;
    if (['town', 'borough', 'suburb'].includes(type)) return 80;
    if (['village', 'hamlet', 'district', 'neighbourhood', 'neighborhood'].includes(type)) return 70;
    if (['state', 'province', 'region', 'county'].includes(type)) return 50;
    if (type === 'administrative' || cls === 'boundary') return 40;
    return 10;
  }

  function isNearSamePoint(a, b) {
    const alat = Number(a?.lat), alon = Number(a?.lon);
    const blat = Number(b?.lat), blon = Number(b?.lon);
    if (![alat, alon, blat, blon].every(Number.isFinite)) return false;
    return Math.abs(alat - blat) < 0.12 && Math.abs(alon - blon) < 0.12;
  }

  function canonicalResultKey(item) {
    const addr = item.address || {};
    const primary = normalizeForSearch(bestDisplayName(item) || bestPrimaryName(item));
    const cityish = normalizeForSearch(addr.city || addr.town || addr.village || addr.municipality || '');
    const state = normalizeForSearch(addr.state || addr.county || '');
    const country = normalizeForSearch(addr.country || '');
    const type = String(item.type || '').toLowerCase();
    const bucket = ['country','city','municipality','town','borough','suburb','village','hamlet'].includes(type)
      ? type
      : (['state','province','region','county','administrative'].includes(type) ? 'admin' : type || 'other');
    return [primary || cityish, cityish, state, country, bucket].join('|');
  }

  function shouldReplaceDuplicate(prev, next) {
    const prevScore = Number(prev.importance || 0) + typePriority(prev) / 100;
    const nextScore = Number(next.importance || 0) + typePriority(next) / 100;
    const prevName = normalizeForSearch(bestDisplayName(prev));
    const nextName = normalizeForSearch(bestDisplayName(next));
    if (nextScore !== prevScore) return nextScore > prevScore;
    if (nextName && prevName && nextName.length !== prevName.length) return nextName.length < prevName.length;
    return Number(next.place_rank || 0) > Number(prev.place_rank || 0);
  }

  function dedupeResults(list) {
    const map = new Map();
    for (const item of list) {
      const key = canonicalResultKey(item);
      const prev = map.get(key);
      if (!prev || shouldReplaceDuplicate(prev, item)) {
        map.set(key, item);
      }
    }

    const compact = [];
    for (const item of map.values()) {
      const duplicateIndex = compact.findIndex(existing => {
        const samePoint = isNearSamePoint(existing, item);
        if (!samePoint) return false;
        const existingName = normalizeForSearch(bestDisplayName(existing) || bestPrimaryName(existing));
        const itemName = normalizeForSearch(bestDisplayName(item) || bestPrimaryName(item));
        const existingCountry = normalizeForSearch(existing.address?.country || '');
        const itemCountry = normalizeForSearch(item.address?.country || '');
        return existingName === itemName && existingCountry === itemCountry;
      });
      if (duplicateIndex >= 0) {
        if (shouldReplaceDuplicate(compact[duplicateIndex], item)) compact[duplicateIndex] = item;
      } else {
        compact.push(item);
      }
    }
    return compact;
  }

  function finalizeResults(list, intent, query) {
    const qNorm = normalizeForSearch(query);
    const needCountry = normalizeForSearch(intent.country || '');
    const needLocality = normalizeForSearch(intent.locality || query);

    let data = dedupeResults(list);

    data = data.filter(item => {
      const addr = item.address || {};
      const hay = normalizeForSearch([
        item.display_name,
        item.name,
        bestDisplayName(item),
        bestPrimaryName(item),
        addr.city,
        addr.town,
        addr.village,
        addr.municipality,
        addr.state,
        addr.country
      ].filter(Boolean).join(' | '));
      if (intent.mode === 'country') {
        return hay.includes(needCountry || qNorm);
      }
      if (needCountry && !hay.includes(needCountry)) return false;
      return hay.includes(needLocality) || hay.includes(qNorm) || scoreResult(item, intent, query) > 120;
    });

    data.sort((a, b) => scoreResult(b, intent, query) - scoreResult(a, intent, query));

    const finalList = [];
    for (const item of data) {
      const duplicateIndex = finalList.findIndex(existing => {
        const existingName = normalizeForSearch(bestDisplayName(existing) || bestPrimaryName(existing));
        const itemName = normalizeForSearch(bestDisplayName(item) || bestPrimaryName(item));
        const existingCountry = normalizeForSearch(existing.address?.country || '');
        const itemCountry = normalizeForSearch(item.address?.country || '');
        const sameName = existingName && itemName && (existingName === itemName || existingName.includes(itemName) || itemName.includes(existingName));
        return sameName && existingCountry === itemCountry && isNearSamePoint(existing, item);
      });
      if (duplicateIndex >= 0) {
        if (shouldReplaceDuplicate(finalList[duplicateIndex], item)) finalList[duplicateIndex] = item;
        continue;
      }
      finalList.push(item);
      if (finalList.length >= 8) break;
    }
    return finalList;
  }


  async function fetchArcgisCandidates(q, options = {}) {
    const textQuery = String(q || '').trim() || String(options.structured?.city || options.structured?.county || options.structured?.state || options.structured?.country || '').trim();
    if (!textQuery) return [];
    const p = new URLSearchParams({
      f: 'pjson',
      SingleLine: textQuery,
      outFields: 'Addr_type,Type,PlaceName,Place_addr,City,Region,RegionAbbr,Country,LongLabel,ShortLabel,Match_addr',
      maxLocations: String(options.limit || 10),
      outSR: '4326',
      forStorage: 'false'
    });
    if (options.countryCode) p.set('sourceCountry', String(options.countryCode).toUpperCase());
    const res = await fetch('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?' + p.toString(), {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const candidates = Array.isArray(json.candidates) ? json.candidates : [];
    return candidates.map((cand, idx) => arcgisCandidateToItem(cand, idx));
  }

  function arcgisCandidateToItem(cand, idx) {
    const a = cand.attributes || {};
    const lon = Number(cand.location?.x);
    const lat = Number(cand.location?.y);
    const country = a.Country || '';
    const region = a.Region || a.RegionAbbr || '';
    const city = a.City || a.PlaceName || '';
    const typeRaw = String(a.Addr_type || a.Type || '').toLowerCase();
    let type = 'address';
    let cls = 'place';
    if (/country/.test(typeRaw)) { type = 'country'; cls = 'boundary'; }
    else if (/(city|metro)/.test(typeRaw)) type = 'city';
    else if (/(region|state|province|county)/.test(typeRaw)) type = 'state';
    else if (/(neighborhood|district|suburb|borough)/.test(typeRaw)) type = 'suburb';
    else if (/(street|pointaddress|address)/.test(typeRaw)) { type = 'road'; cls = 'address'; }
    const ex = cand.extent || {};
    const bbox = [Number(ex.ymin), Number(ex.ymax), Number(ex.xmin), Number(ex.xmax)];
    return {
      place_id: 'arcgis-' + (cand.address || a.LongLabel || a.Match_addr || idx) + '-' + idx,
      lat: Number.isFinite(lat) ? String(lat) : '0',
      lon: Number.isFinite(lon) ? String(lon) : '0',
      display_name: a.LongLabel || cand.address || a.Match_addr || [city, region, country].filter(Boolean).join(', '),
      name: a.ShortLabel || city || cand.address || a.Match_addr || '',
      class: cls,
      type,
      importance: Number(cand.score || 0) / 100,
      place_rank: type === 'country' ? 4 : (type === 'state' ? 8 : (type === 'city' ? 16 : 20)),
      boundingbox: bbox.every(Number.isFinite) ? bbox.map(String) : null,
      address: {
        city: city || '',
        state: region || '',
        country: country || ''
      },
      namedetails: {
        name: a.ShortLabel || city || cand.address || '',
        'name:en': a.ShortLabel || city || cand.address || ''
      }
    };
  }

  async function fetchSearchVariant(q, options = {}) {
    const p = new URLSearchParams({ format:'jsonv2', limit:String(options.limit || 10), addressdetails:'1', namedetails:'1', extratags:'1', 'accept-language':'ko,en' });
    if (options.structured) {
      Object.entries(options.structured).forEach(([k,v]) => { if (v) p.set(k, v); });
    } else {
      p.set('q', q);
    }
    if (options.countryCode) p.set('countrycodes', options.countryCode);
    if (options.featureType) p.set('featuretype', options.featureType);
    const res = await fetch('https://nominatim.openstreetmap.org/search?' + p.toString(), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  async function performSearchQueries(q) {
    const intent = parseSearchIntent(q);
    const variants = buildQueryVariants(q, intent);
    const jobs = [];

    if (intent.mode === 'country') {
      jobs.push(fetchSearchVariant(q, { limit: 10 }).catch(() => []));
      jobs.push(fetchSearchVariant(resolveCountryAlias(q), { limit: 10 }).catch(() => []));
      jobs.push(fetchSearchVariant('', {
        countryCode: intent.countryCode,
        structured: { country: intent.country || resolveCountryAlias(q) },
        limit: 10
      }).catch(() => []));
      jobs.push(fetchSearchVariant(intent.country || resolveCountryAlias(q), { featureType: 'country', limit: 8 }).catch(() => []));
    } else {
      for (const variant of variants) {
        jobs.push(fetchSearchVariant(variant, { countryCode: intent.countryCode, limit: 8 }).catch(() => []));
        jobs.push(fetchSearchVariant(variant, { countryCode: intent.countryCode, featureType: 'city', limit: 6 }).catch(() => []));
      }

      if (intent.locality) {
        const localityAliases = resolvePlaceAliases(intent.locality).slice(0, 6);
        for (const locality of localityAliases) {
          jobs.push(fetchSearchVariant('', {
            countryCode: intent.countryCode,
            structured: { city: locality, country: intent.country || '' },
            limit: 8
          }).catch(() => []));
          jobs.push(fetchSearchVariant('', {
            countryCode: intent.countryCode,
            structured: { county: locality, state: intent.admin || '', country: intent.country || '' },
            limit: 6
          }).catch(() => []));
          jobs.push(fetchSearchVariant(`${locality}${intent.country ? ', ' + intent.country : ''}`, {
            countryCode: intent.countryCode,
            limit: 6
          }).catch(() => []));
        }
      }

      if (!intent.country && !intent.locality.includes(',')) {
        jobs.push(fetchSearchVariant(q, { featureType: 'city', limit: 8 }).catch(() => []));
      }
    }

    const batches = await Promise.all(jobs);
    let data = dedupeResults(batches.flat());

    if (data.length < 5) {
      const arcJobs = [];
      const arcVariants = buildQueryVariants(q, intent).slice(0, 6);
      if (intent.mode === 'country') {
        arcJobs.push(fetchArcgisCandidates(intent.country || q, { countryCode: intent.countryCode, limit: 8 }).catch(() => []));
      } else {
        for (const variant of arcVariants) {
          arcJobs.push(fetchArcgisCandidates(variant, { countryCode: intent.countryCode, limit: 6 }).catch(() => []));
        }
      }
      const arcBatches = await Promise.all(arcJobs);
      data = dedupeResults(data.concat(arcBatches.flat()));
    }

    const finalData = finalizeResults(data, intent, q);
    return { intent, data: finalData };
  }

  async function doSearch(q) {
    msgBox('검색 중...');
    spinner.style.display = 'block';
    try {
      const { intent, data } = await performSearchQueries(q);
      spinner.style.display = 'none';
      if (!data.length) { msgBox('검색 결과가 없습니다 🔍'); items = []; return; }
      items = data; actIdx = -1; results.innerHTML = ''; results.style.display = 'block'; row.classList.add('has-results');
      data.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = 'r-item';
        const pts = item.display_name.split(',').map(s => s.trim()).filter(Boolean);
        const primary = bestDisplayName(item);
        const localArea = item.address?.city || item.address?.town || item.address?.village || item.address?.municipality || item.address?.county || '';
        const secondary = [item.address?.state, item.address?.country].filter(Boolean);
        const uniqueParts = [];
        const pushUnique = (value) => {
          const n = normalizeForSearch(value);
          if (!value || uniqueParts.some(v => normalizeForSearch(v) === n)) return;
          uniqueParts.push(value);
        };
        pushUnique(primary);
        if (secondary[0] && normalizeForSearch(secondary[0]) !== normalizeForSearch(primary)) pushUnique(secondary[0]);
        const main = uniqueParts.join(', ') || pts.slice(0, 2).join(', ');
        const subParts = [];
        const pushSub = (value) => {
          const n = normalizeForSearch(value);
          if (!value || subParts.some(v => normalizeForSearch(v) === n) || uniqueParts.some(v => normalizeForSearch(v) === n)) return;
          subParts.push(value);
        };
        pushSub(localArea);
        secondary.slice(1).forEach(pushSub);
        pts.slice(2, 4).forEach(pushSub);
        const sub = subParts.join(', ');
        el.innerHTML = '<span class="r-ico">' + ico(item.type, item.class) + '</span><div class="r-txt"><div class="r-name">' + main + '</div>' + (sub ? '<div class="r-sub">' + sub + '</div>' : '') + '</div>';
        el.addEventListener('click', () => flyTo(item));
        el.addEventListener('mouseenter', () => setAct(i));
        results.appendChild(el);
      });
    } catch (err) {
      spinner.style.display = 'none';
      msgBox('검색 오류 — 인터넷 연결을 확인하세요');
    }
  }

  function flyTo(item) {
    const lat = parseFloat(item.lat), lon = parseFloat(item.lon), type = item.type || '', cls = item.class || '';
    const shortName = item.display_name.split(',').slice(0,2).map(s => s.trim()).join(', ');
    lastSelectedText = shortName;
    input.value = shortName;
    clrBtn.style.display = 'block';
    clearResults();

    const bbox = Array.isArray(item.boundingbox) ? item.boundingbox.map(Number) : null;
    if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) {
      const south = bbox[0], north = bbox[1], west = bbox[2], east = bbox[3];
      const latSpan = Math.max(0.01, Math.abs(north - south));
      const lonSpan = Math.max(0.01, Math.abs(east - west));
      let expand = 1.25;
      if (type === 'city' || type === 'municipality') expand = 1.1;
      else if (type === 'town' || type === 'suburb' || type === 'village') expand = 1.08;
      else if (type === 'country') expand = 1.22;
      const padded = Cesium.Rectangle.fromDegrees(
        west - lonSpan * (expand - 1) / 2,
        south - latSpan * (expand - 1) / 2,
        east + lonSpan * (expand - 1) / 2,
        north + latSpan * (expand - 1) / 2
      );
      viewer.camera.flyTo({
        destination: padded,
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 2.35,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: function () {
          const center = Cesium.Rectangle.center(padded);
          const currentHeight = Math.max(viewer.camera.positionCartographic.height * 0.92, 1200);
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, currentHeight),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 }
          });
        }
      });
      return;
    }

    let alt;
    if (type === 'country') alt = 2800000;
    else if (type === 'state' || type === 'province' || cls === 'boundary') alt = 700000;
    else if (type === 'city' || type === 'municipality') alt = 50000;
    else if (type === 'town') alt = 28000;
    else if (type === 'village' || type === 'suburb') alt = 12000;
    else if (type === 'peak' || type === 'volcano') alt = 28000;
    else if (type === 'island' || type === 'bay') alt = 80000;
    else if (type === 'lake' || type === 'river') alt = 70000;
    else if (type === 'airport') alt = 18000;
    else if (type === 'building' || type === 'house') alt = 2200;
    else if (type === 'road' || type === 'street') alt = 7000;
    else alt = 80000;
    const destination = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    viewer.camera.flyTo({
      destination,
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      duration: 2.35,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: function () {
        viewer.camera.setView({ destination, orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 } });
      }
    });
  }
  window.addEventListener('resize', function () {
    viewer.resolutionScale = isMobile ? 1 : Math.min((window.devicePixelRatio || 1) * 1.08, 1.7);
    scene.requestRender();
  });
})();
