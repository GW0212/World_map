(function () {
  'use strict';

  const MAX_VIEW_LATITUDE = 84.8;
  const DEFAULT_STYLE = 'latestSatellite';
  const LATEST_SATELLITE_CACHE_KEY = 'worldmap:latest-satellite-date:v2';
  const LATEST_SATELLITE_MAX_LOOKBACK_DAYS = 30;
  const LATEST_SATELLITE_STABLE_OFFSET_DAYS = 3;
  // 최신 일일 위성은 전 지구/대륙 단위에서만 사용한다.
  // 상세 확대 구간은 고해상도 위성으로 고정해 NASA 고배율 오류 타일과 트래픽 폭증을 막는다.
  const LATEST_SATELLITE_CLOSE_ZOOM_HEIGHT = 7600000;
  const LATEST_SATELLITE_RETURN_ZOOM_HEIGHT = 9800000;
  const HOME_VIEW = {
    lon: 127.5,
    lat: 36.0,
    alt: 18000000,
    heading: 0,
    pitch: -90,
    roll: 0,
  };

  window.CESIUM_BASE_URL = 'https://cdn.jsdelivr.net/npm/cesium@1.95.0/Build/Cesium/';

  function isMobileDevice() {
    return window.matchMedia('(max-width: 768px)').matches ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  function configureRequestBudget() {
    const mobile = isMobileDevice();
    if (Cesium.RequestScheduler) {
      Cesium.RequestScheduler.throttleRequests = true;
      Cesium.RequestScheduler.maximumRequestsPerServer = mobile ? 6 : 6;
      Cesium.RequestScheduler.maximumRequests = mobile ? 22 : 32;
    }
  }

  function boot() {
    Cesium.Ion.defaultAccessToken = undefined;
    configureRequestBudget();

    const creditSink = document.createElement('div');
    creditSink.style.display = 'none';
    document.body.appendChild(creditSink);

    const viewer = createViewer(creditSink);
    const scene = viewer.scene;
    const baseLayer = viewer.imageryLayers.get(0);
    const styleManager = createStyleManager(viewer, baseLayer);
    const overlays = createOverlayLayers(viewer);
    const koreaSubwayOverlay = createKoreaSubwayOverlay(viewer);
    styleManager.attachOverlays(overlays);
    styleManager.attachKoreaSubwayOverlay(koreaSubwayOverlay);

    configureScene(viewer);

    const sharedState = {
      currentStyle: DEFAULT_STYLE,
      lastSearchResult: null,
      lastPointerCartesian: null,
      lastPointerPosition: null,
      shareToastTimer: null,
    };

    const isMobileInit = isMobileDevice();
    const initialView = isMobileInit ? null : readViewFromHash(); // 모바일: 항상 HOME_VIEW
    if (initialView) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(initialView.lon, initialView.lat, initialView.alt),
        orientation: {
          heading: Cesium.Math.toRadians(initialView.heading || 0),
          pitch: Cesium.Math.toRadians(initialView.pitch || -90),
          roll: 0,
        },
      });
      if (initialView.style) {
        sharedState.currentStyle = initialView.style;
      }
    } else {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
        orientation: {
          heading: Cesium.Math.toRadians(HOME_VIEW.heading),
          pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
          roll: HOME_VIEW.roll,
        },
      });
    }

    styleManager.setStyle(sharedState.currentStyle);

    wireLoading(scene);
    wireInfoBar(viewer, sharedState);
    wireImageryMetadata(viewer);
    wireHomeButton(viewer, sharedState, styleManager);
    wireSearch(viewer, sharedState);
    wireShare(viewer, sharedState, styleManager);
    wireCurrentLocation(viewer, sharedState);
    wirePanelExclusivity();
    wireStylePicker(viewer, styleManager, sharedState);
    wireMiniMap(viewer);
    wireMobileGestures(viewer);

    scene.requestRender();
  }


  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatGibsDate(date) {
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  }

  function getUtcDateOffset(daysAgo) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
  }

  function getLatestSatelliteCandidateDates() {
    const priorityOffsets = [3, 4, 5, 7, 10, 14];
    const dates = [];
    const seen = new Set();
    priorityOffsets.forEach((offset) => {
      if (offset > LATEST_SATELLITE_MAX_LOOKBACK_DAYS) return;
      const date = formatGibsDate(getUtcDateOffset(offset));
      if (!seen.has(date)) {
        seen.add(date);
        dates.push(date);
      }
    });
    return dates;
  }

  function buildLatestSatelliteTileUrl(date) {
    return 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
      'VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' + date +
      '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';
  }

  function createLatestSatelliteProvider(date) {
    return new Cesium.UrlTemplateImageryProvider({
      url: buildLatestSatelliteTileUrl(date),
      minimumLevel: 0,
      // 일일 위성은 지구 전체/대륙 보기 전용이다. 높은 줌의 NASA 타일 요청을 막아 렉과 회색 오류 타일을 차단한다.
      maximumLevel: 6,
      // 남극 주변은 관측 누락 영역이 생길 수 있으나, tileDiscardPolicy 가 검정/회색 오류 타일을 버려 하단 고해상도 타일이 메워준다.
      // 화면 하단부까지 최신 위성(구름 포함)이 보이도록 남위 경계를 -80°까지 확장한다.
      rectangle: Cesium.Rectangle.fromDegrees(-180, -80, 180, 82),
      tileDiscardPolicy: createDarkTileDiscardPolicy(),
      credit: 'NASA GIBS / VIIRS SNPP Corrected Reflectance True Color (' + date + ')',
    });
  }

  function createDarkTileDiscardPolicy() {
    return {
      isReady: function () { return true; },
      shouldDiscardImage: function (image) {
        try {
          if (!image || !image.width || !image.height) return false;
          const canvas = document.createElement('canvas');
          const size = 18;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return false;
          ctx.drawImage(image, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          let dark = 0;
          let grayUnavailable = 0;
          let colorful = 0;
          let total = 0;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 8) continue;
            total += 1;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const brightness = (r + g + b) / 3;
            const spread = Math.max(r, g, b) - Math.min(r, g, b);
            // NASA 일일 위성 타일에서 관측 누락 영역은 검정/짙은 남색으로 들어올 수 있다.
            // 실제 해양색보다 훨씬 어두운 픽셀 비율이 높으면 해당 타일을 폐기해 하단 고해상도 타일이 보이게 한다.
            if (brightness < 48 && r < 40 && g < 55 && b < 80) dark += 1;
            // 고배율에서 NASA가 회색 "Map data not yet available" 타일을 내려줄 때가 있다.
            // 회색 배경 비율이 지나치게 높고 컬러 픽셀이 거의 없으면 해당 타일을 버려 확대 화면 오류 문구를 막는다.
            if (brightness > 145 && brightness < 235 && spread < 18) grayUnavailable += 1;
            if (spread > 32) colorful += 1;
          }
          if (total <= 0) return false;
          return dark / total > 0.28 || (grayUnavailable / total > 0.55 && colorful / total < 0.12);
        } catch (error) {
          return false;
        }
      },
    };
  }

  function preloadImage(url, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const img = new Image();
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs || 3500);
      img.onload = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(true);
      };
      img.onerror = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(false);
      };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  function testLatestSatelliteDate(date) {
    const samples = [
      { z: '3', y: '3', x: '6' },
      { z: '3', y: '3', x: '4' },
      { z: '3', y: '4', x: '6' },
    ];
    return Promise.all(samples.map(sample => {
      const sampleUrl = buildLatestSatelliteTileUrl(date)
        .replace('{z}', sample.z)
        .replace('{y}', sample.y)
        .replace('{x}', sample.x) + '?_=' + Date.now();
      return preloadImage(sampleUrl, 4500);
    })).then(results => results.filter(Boolean).length >= 2);
  }

  function readCachedLatestSatelliteDate() {
    try {
      const raw = window.localStorage.getItem(LATEST_SATELLITE_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || !cached.imageryDate || !cached.checkedAt) return null;
      const checkedAt = new Date(cached.checkedAt).getTime();
      if (!Number.isFinite(checkedAt)) return null;
      const cacheAge = Date.now() - checkedAt;
      if (cacheAge > 24 * 60 * 60 * 1000) return null;
      return cached.imageryDate;
    } catch (error) {
      return null;
    }
  }

  function saveCachedLatestSatelliteDate(date) {
    try {
      window.localStorage.setItem(LATEST_SATELLITE_CACHE_KEY, JSON.stringify({
        imageryDate: date,
        checkedAt: new Date().toISOString(),
      }));
    } catch (error) {}
  }

  function updateSatelliteDateLabels(latestDate, isCloseZoomFallback) {
    const latestDateEl = document.getElementById('latest-satellite-date-text');
    if (latestDateEl) {
      // 현재 UI에서는 별도 날짜 문구를 노출하지 않는다.
      // 값은 유지해 두어 추후 필요 시 바로 표기할 수 있게 한다.
      const prefix = isCloseZoomFallback ? '확대 시 고해상도 자동 전환 · ' : '일일 위성 기준일 · ';
      latestDateEl.textContent = prefix + (latestDate || '확인 중');
    }
  }

  function createViewer(creditSink) {
    const commonOptions = {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: creditSink,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
      useBrowserRecommendedResolution: false,
    };
    try {
      // UrlTemplateImageryProvider: 메타데이터 요청 없이 즉시 타일 로드 시작 (무한로딩 방지)
      return new Cesium.Viewer('cesiumContainer', {
        ...commonOptions,
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
          credit: 'Esri, Maxar, Earthstar Geographics',
        }),
      });
    } catch (error) {
      console.warn('primary imagery provider failed, using fallback:', error);
      return new Cesium.Viewer('cesiumContainer', {
        ...commonOptions,
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
          url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          maximumLevel: 19,
          credit: 'OpenStreetMap contributors',
        }),
      });
    }
  }

  function createOverlayLayers(viewer) {
    const overlays = {
      arcgisLabels: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
      })),
      cartoLightLabels: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
        maximumLevel: 20,
        credit: 'CARTO / OpenStreetMap',
      })),
      arcgisOverlay: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
      })),
      railOverlay: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
        maximumLevel: 18,
        credit: 'OpenRailwayMap / OpenStreetMap',
      })),
    };

    overlays.arcgisLabels.alpha = 1.0;
    overlays.cartoLightLabels.alpha = 0.75;
    overlays.arcgisOverlay.alpha = 1.0;
    overlays.railOverlay.alpha = 0;
    overlays.railOverlay.show = false;
    return overlays;
  }

  function createStyleManager(viewer, initialBaseLayer) {
    let overlays = null;
    let koreaSubwayOverlay = null;

    const mobile = isMobileDevice();
    // 기본/첫 화면부터 고해상도 위성으로 고정한다.
    // NASA 일일 최신 위성(구름 포함) 레이어는 요청하지 않아 하단 검정 원/누락 타일과
    // 최신 위성 ↔ 고해상도 위성 간헐 전환 현상을 차단한다.
    const dailySatelliteEnabled = false;
    let latestSatelliteHighResFallback = false;
    let forceLatestUntil = 0;
    let activeStyle = DEFAULT_STYLE;
    let latestActiveDate = readCachedLatestSatelliteDate() || formatGibsDate(getUtcDateOffset(LATEST_SATELLITE_STABLE_OFFSET_DAYS));
    const initialLatestSatelliteDate = latestActiveDate;
    updateSatelliteDateLabels(latestActiveDate, false);

    const baseLayers = {
      latestSatellite: dailySatelliteEnabled
        ? viewer.imageryLayers.addImageryProvider(createLatestSatelliteProvider(initialLatestSatelliteDate), 0)
        : null,
      satellite: initialBaseLayer,
      roadmap: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        maximumLevel: 20,
        credit: 'CARTO / OpenStreetMap contributors',
      }), 0),
      terrain: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri World Topographic Map',
      }), 0),
    };

    function attachLatestSatelliteRecovery(layer) {
      const provider = layer && layer.imageryProvider;
      if (!provider || !provider.errorEvent || typeof provider.errorEvent.addEventListener !== 'function') return;
      provider.errorEvent.addEventListener((error) => {
        console.warn('latest satellite imagery provider error:', error);
        if (activeStyle !== 'latestSatellite') return;
        // 개별 타일 오류 때문에 최신 위성 전체를 꺼버리면 화면이 1번 고해상도 위성으로 고정된다.
        // 레이어는 유지하고 누락 타일만 하단 고해상도 위성이 보정하게 둔다.
        layer.show = !latestSatelliteHighResFallback;
        layer.alpha = latestSatelliteHighResFallback ? 0 : 1.0;
        if (baseLayers.satellite) {
          baseLayers.satellite.show = true;
          baseLayers.satellite.alpha = 1;
        }
        viewer.scene.requestRender();
      });
    }

    attachLatestSatelliteRecovery(baseLayers.latestSatellite);

    Object.values(baseLayers).forEach(layer => {
      if (!layer) return;
      layer.show = false;
      layer.alpha = 0;
    });
    baseLayers.satellite.show = true;
    baseLayers.satellite.alpha = 1;

    function tuneLayer(layer, values) {
      if (!layer) return;
      layer.brightness = values.brightness;
      layer.contrast = values.contrast;
      layer.gamma = values.gamma;
      layer.saturation = values.saturation;
    }

    function applyBaseLayerTuning(style) {
      Object.values(baseLayers).forEach(layer => tuneLayer(layer, { brightness: 1.0, contrast: 1.0, gamma: 1.0, saturation: 1.0 }));
      if (style === 'latestSatellite') {
        tuneLayer(baseLayers.satellite, { brightness: 1.03, contrast: 1.08, gamma: 0.97, saturation: 1.04 });
        tuneLayer(baseLayers.latestSatellite, { brightness: 1.04, contrast: 1.08, gamma: 0.96, saturation: 1.08 });
      } else if (style === 'satellite') {
        tuneLayer(baseLayers.satellite, { brightness: 1.03, contrast: 1.1, gamma: 0.96, saturation: 1.04 });
      } else if (style === 'terrain') {
        tuneLayer(baseLayers.terrain, { brightness: 1.02, contrast: 1.06, gamma: 0.99, saturation: 1.02 });
      }
    }

    function raiseReferenceOverlays() {
      if (!overlays) return;
      ['arcgisLabels', 'arcgisOverlay', 'cartoLightLabels', 'railOverlay'].forEach((name) => {
        const layer = overlays[name];
        if (!layer) return;
        try { viewer.imageryLayers.raiseToTop(layer); } catch (error) {}
      });
    }

    function getCameraHeight() {
      const cartographic = viewer.camera && viewer.camera.positionCartographic;
      return cartographic && Number.isFinite(cartographic.height) ? cartographic.height : Infinity;
    }

    function shouldUseHighResSatelliteFallback() {
      const height = getCameraHeight();
      if (!baseLayers.latestSatellite) return true;
      if (Date.now() < forceLatestUntil) {
        latestSatelliteHighResFallback = false;
        return false;
      }
      const wasHighRes = latestSatelliteHighResFallback;
      if (latestSatelliteHighResFallback) {
        latestSatelliteHighResFallback = height < LATEST_SATELLITE_RETURN_ZOOM_HEIGHT;
      } else {
        latestSatelliteHighResFallback = height < LATEST_SATELLITE_CLOSE_ZOOM_HEIGHT;
      }
      // 고해상도 → 최신 위성으로 전환되는 순간, forceLatestUntil 을 짧게 설정해
      // 최신 위성 타일이 alpha 0 상태로 미리 캐싱되어 있어도 순간적으로 표시를 보장한다.
      if (wasHighRes && !latestSatelliteHighResFallback) {
        forceLatestUntil = Date.now() + 300;
      }
      return latestSatelliteHighResFallback;
    }

    function hideNonSatelliteBaseLayers() {
      ['roadmap', 'terrain'].forEach(name => {
        const layer = baseLayers[name];
        if (!layer) return;
        layer.show = false;
        layer.alpha = 0;
      });
    }

    function syncLatestSatelliteHybridLayer() {
      if (activeStyle !== 'latestSatellite') return;
      hideNonSatelliteBaseLayers();

      const useHighResFallback = shouldUseHighResSatelliteFallback();

      baseLayers.satellite.show = true;
      // 고해상도 기본 위성은 항상 하단에 유지한다. 최신 위성은 위에 덮어서 쓰고,
      // 누락/극지/오류 타일은 하단 고해상도 위성이 즉시 메워 검은 원·회색 오류 화면을 막는다.
      baseLayers.satellite.alpha = 1;

      if (baseLayers.latestSatellite) {
        // show 를 false 로 끄면 Cesium 이 해당 레이어 타일 캐시를 해제한다.
        // 축소 시 다시 타일을 불러오는 동안 고해상도 위성이 2~3초 노출되는 원인이므로,
        // 항상 show=true 로 유지해 타일을 캐시에 보존하고 alpha 만 0으로 만들어 숨긴다.
        baseLayers.latestSatellite.show = true;
        baseLayers.latestSatellite.alpha = useHighResFallback ? 0 : 1.0;
        if (!useHighResFallback) {
          try { viewer.imageryLayers.raiseToTop(baseLayers.latestSatellite); } catch (error) {}
        } else {
          // 고해상도 폴백 중에는 satellite 레이어를 latestSatellite(alpha=0) 위로 올려
          // 고해상도 위성이 정상적으로 보이도록 한다.
          try { viewer.imageryLayers.raiseToTop(baseLayers.satellite); } catch (error) {}
          // raiseToTop 후 latestSatellite 는 satellite 아래에 있으므로 alpha=0 이면 완전히 숨겨진다.
        }
      }
      raiseReferenceOverlays();
      updateSatelliteDateLabels(latestActiveDate, useHighResFallback);
      viewer.scene.requestRender();
    }

    function syncOverlayVisibility(style) {
      if (!overlays) return;
      const isSatellite = style === 'latestSatellite' || style === 'satellite';
      overlays.arcgisLabels.show = isSatellite;
      overlays.arcgisLabels.alpha = isSatellite ? 1.0 : 0;
      overlays.arcgisOverlay.show = isSatellite;
      overlays.arcgisOverlay.alpha = isSatellite ? 1.0 : 0;
      const isRoadmap = style === 'roadmap';
      overlays.cartoLightLabels.show = isRoadmap;
      overlays.cartoLightLabels.alpha = isRoadmap ? 0.82 : 0;
      overlays.railOverlay.show = false;
      overlays.railOverlay.alpha = 0;
      // 일반 지도와 위성 지도 모두 지하철역/노선 오버레이를 표시한다.
      // 위성 전환 시 오버레이가 숨겨지지 않도록 latestSatellite/satellite도 허용한다.
      if (koreaSubwayOverlay) koreaSubwayOverlay.setVisible(style === 'roadmap' || isSatellite);
      if (style === 'latestSatellite') syncLatestSatelliteHybridLayer();
      raiseReferenceOverlays();
      viewer.scene.requestRender();
    }

    const manager = {
      attachOverlays(value) {
        overlays = value;
        syncOverlayVisibility(DEFAULT_STYLE);
      },
      attachKoreaSubwayOverlay(value) {
        koreaSubwayOverlay = value;
        syncOverlayVisibility(DEFAULT_STYLE);
      },
      prepareHomeReturn() {
        activeStyle = DEFAULT_STYLE;
        // 홈 복귀 시에도 고해상도 위성 상태를 유지한다.
        forceLatestUntil = 0;
        latestSatelliteHighResFallback = true;
        syncLatestSatelliteHybridLayer();
      },
      finishHomeReturn() {
        activeStyle = DEFAULT_STYLE;
        forceLatestUntil = 0;
        latestSatelliteHighResFallback = true;
        syncLatestSatelliteHybridLayer();
        window.setTimeout(syncLatestSatelliteHybridLayer, 1500);
      },
      wireProviderRecovery() {
        const fallbackToSatellite = () => {
          activeStyle = 'latestSatellite';
          Object.values(baseLayers).forEach(layer => {
            if (!layer) return;
            layer.show = false;
            layer.alpha = 0;
          });
          baseLayers.satellite.show = true;
          baseLayers.satellite.alpha = 1;
          if (baseLayers.latestSatellite) {
            baseLayers.latestSatellite.show = false;
            baseLayers.latestSatellite.alpha = 0;
          }
          applyBaseLayerTuning('latestSatellite');
          syncOverlayVisibility('latestSatellite');
          if (koreaSubwayOverlay) koreaSubwayOverlay.setVisible(true);
          viewer.scene.requestRender();
        };
        ['roadmap', 'terrain'].forEach((name) => {
          const provider = baseLayers[name] && baseLayers[name].imageryProvider;
          if (provider && provider.errorEvent && typeof provider.errorEvent.addEventListener === 'function') {
            provider.errorEvent.addEventListener((error) => {
              console.warn(name + ' imagery provider error:', error);
              if (baseLayers[name].show) fallbackToSatellite();
            });
          }
        });
      },
      setStyle(style) {
        const normalized = style === 'satellite' ? 'latestSatellite' : style;
        const key = normalized === 'latestSatellite' || baseLayers[normalized] ? normalized : DEFAULT_STYLE;
        activeStyle = key;
        Object.values(baseLayers).forEach(layer => {
          if (!layer) return;
          layer.show = false;
          layer.alpha = 0;
        });
        if (key === 'latestSatellite') {
          syncLatestSatelliteHybridLayer();
        } else if (baseLayers[key]) {
          baseLayers[key].show = true;
          baseLayers[key].alpha = 1;
        }
        applyBaseLayerTuning(key);
        syncOverlayVisibility(key);
        return key;
      },
    };

    async function refreshLatestSatelliteLayer() {
      if (!dailySatelliteEnabled || !baseLayers.latestSatellite) return;
      const candidates = getLatestSatelliteCandidateDates();
      for (const date of candidates) {
        const ok = await testLatestSatelliteDate(date);
        if (!ok) continue;
        saveCachedLatestSatelliteDate(date);
        const currentProvider = baseLayers.latestSatellite && baseLayers.latestSatellite.imageryProvider;
        const currentUrl = currentProvider && currentProvider.url;
        if (typeof currentUrl === 'string' && currentUrl.indexOf('/' + date + '/') !== -1) {
          latestActiveDate = date;
          updateSatelliteDateLabels(latestActiveDate, activeStyle === 'latestSatellite' && latestSatelliteHighResFallback);
          return;
        }
        const wasActive = activeStyle === 'latestSatellite';
        const oldLayer = baseLayers.latestSatellite;
        const newLayer = viewer.imageryLayers.addImageryProvider(createLatestSatelliteProvider(date), 0);
        latestActiveDate = date;
        const useHighResFallback = wasActive && shouldUseHighResSatelliteFallback();
        newLayer.show = wasActive && !useHighResFallback;
        newLayer.alpha = wasActive && !useHighResFallback ? 1.0 : 0;
        attachLatestSatelliteRecovery(newLayer);
        baseLayers.latestSatellite = newLayer;
        try { viewer.imageryLayers.remove(oldLayer, true); } catch (error) {}
        updateSatelliteDateLabels(latestActiveDate, useHighResFallback);
        if (wasActive) {
          applyBaseLayerTuning('latestSatellite');
          syncLatestSatelliteHybridLayer();
        }
        viewer.scene.requestRender();
        return;
      }
      console.warn('latest satellite imagery date check failed; using cached/default NASA GIBS date.');
    }

    let latestHybridRaf = null;
    function scheduleLatestSatelliteHybridSync() {
      if (activeStyle !== 'latestSatellite') return;
      if (latestHybridRaf) return;
      latestHybridRaf = window.requestAnimationFrame(() => {
        latestHybridRaf = null;
        syncLatestSatelliteHybridLayer();
      });
    }
    if (dailySatelliteEnabled && viewer.camera && viewer.camera.changed && typeof viewer.camera.changed.addEventListener === 'function') {
      viewer.camera.changed.addEventListener(scheduleLatestSatelliteHybridSync);
    }

    manager.wireProviderRecovery();
    // 자동 날짜 탐색은 여러 날짜 샘플 타일을 요청해 전환/홈 복귀 시 트래픽과 끊김을 만들 수 있어 비활성화한다.
    // 기본 기준일은 접속일 기준 안정화된 최신일(UTC-3일)로 매번 갱신된다.
    // if (dailySatelliteEnabled) window.setTimeout(refreshLatestSatelliteLayer, 800);
    return manager;
  }


  function createCloudLayer(viewer) {
    const earthRadius = 6378137.0;
    const cloudScale = 1.012;
    const cloudAlphaBase = 0.78;
    const cloudEntity = viewer.entities.add({
      name: 'animated-cloud-layer',
      position: Cesium.Cartesian3.ZERO,
      orientation: new Cesium.CallbackProperty(() => {
        const seconds = Date.now() / 1000;
        const heading = Cesium.Math.toRadians((seconds * 0.65) % 360);
        return Cesium.Transforms.headingPitchRollQuaternion(
          Cesium.Cartesian3.ZERO,
          new Cesium.HeadingPitchRoll(heading, 0, 0)
        );
      }, false),
      ellipsoid: {
        radii: new Cesium.Cartesian3(earthRadius * cloudScale, earthRadius * cloudScale, earthRadius * cloudScale),
        material: new Cesium.ImageMaterialProperty({
          image: 'clouds_overlay.png',
          transparent: true,
          color: new Cesium.CallbackProperty(() => {
            const height = (viewer && viewer.camera && viewer.camera.positionCartographic && viewer.camera.positionCartographic.height) || 0;
            const alpha = height < 1500000 ? 0.34 : height < 5000000 ? 0.52 : cloudAlphaBase;
            return Cesium.Color.WHITE.withAlpha(alpha);
          }, false),
        }),
        outline: false,
        subdivisions: 128,
        stackPartitions: 128,
        slicePartitions: 128,
      },
    });
    cloudEntity.show = true;
    if (viewer.scene && viewer.scene.postRender) {
      viewer.scene.postRender.addEventListener(() => viewer.scene.requestRender());
    }
    return cloudEntity;
  }

  function createKoreaSubwayOverlay(viewer) {
    const DATA_URL = 'https://overpass-api.de/api/interpreter';
    // v47: 전국 정적 보강 데이터 보강 + 3호선 지역 오인 보정.
    // 정적 노선만 사용해 지하철역/노선 누락, 노선 분기, 중복 점, 중간 끊김을 차단한다.
    const CACHE_KEY = 'worldmap:korea-subway-overlay:v47-national-complete-static';
    const LEGACY_CACHE_KEYS = ['worldmap:korea-subway-overlay:v46-national-static-full', 'worldmap:korea-subway-overlay:v45-static-topology', 'worldmap:korea-subway-overlay:v44-label-line-stable', 'worldmap:korea-subway-overlay:v43-station-dedupe', 'worldmap:korea-subway-overlay:v42-transfer-line-dots', 'worldmap:korea-subway-overlay:v41-clean-static-lines', 'worldmap:korea-subway-overlay:v40-national', 'worldmap:korea-subway-overlay:v35', 'worldmap:korea-subway-overlay:v34', 'worldmap:korea-subway-overlay:v33', 'worldmap:korea-subway-overlay:v28', 'worldmap:korea-subway-overlay:v27', 'worldmap:korea-subway-overlay:v25', 'worldmap:korea-subway-overlay:v24', 'worldmap:korea-subway-overlay:v2'];
    const CACHE_KEYS = [CACHE_KEY];
    const CACHE_TTL = 1000 * 60 * 60 * 24 * 14;
    const dataSource = new Cesium.CustomDataSource('korea-subway-overlay');

    function purgeLegacySubwayCache() {
      try {
        LEGACY_CACHE_KEYS.forEach((cacheKey) => localStorage.removeItem(cacheKey));
      } catch (error) {
        console.warn('legacy subway cache cleanup failed:', error);
      }
    }

    purgeLegacySubwayCache();
    dataSource.show = false;
    viewer.dataSources.add(dataSource);
    window.KR_SUBWAY_OVERLAY_DATA = window.KR_SUBWAY_OVERLAY_DATA || null;

    const lineColorMap = {
      '1호선': '#0D3692', '2호선': '#33A23D', '3호선': '#FE5B10', '4호선': '#32A1C8',
      '5호선': '#8B50A4', '6호선': '#C55C1D', '7호선': '#54640D', '8호선': '#F14C82',
      '9호선': '#BDB092', '공항철도': '#0090D2', '공항철도선': '#0090D2', '신분당선': '#D31145',
      '수인분당선': '#F5A200', '수인·분당선': '#F5A200', '경의중앙선': '#77C4A3', '경춘선': '#0C8E72',
      '서해선': '#8FC31F', '신림선': '#6789CA', '우이신설선': '#B7C452', '김포골드라인': '#A17800',
      '의정부경전철': '#FDA600', '에버라인': '#6FB245', '인천1호선': '#7CA8D5', '인천2호선': '#ED8B00',
      '부산1호선': '#F06A00', '부산2호선': '#81BF48', '부산3호선': '#BB8C00', '부산4호선': '#2D9EDB',
      '부산김해경전철': '#875CAC', '부산-김해경전철': '#875CAC', '김해경전철': '#875CAC',
      '동해선': '#0054A6', '대구1호선': '#D93F5C', '대구2호선': '#00A84D', '대구3호선': '#F4A116',
      '대전1호선': '#007448', '광주1호선': '#0090D2', 'GTX-A': '#9B6B43'
    };

    function resolveColor(tags = {}) {
      const candidates = [tags.colour, tags.color, tags['line:colour'], tags.ref, tags.name, tags.route];
      for (const value of candidates) {
        if (!value) continue;
        const items = String(value).split(/[\/,|]/).map(v => v.trim()).filter(Boolean);
        for (const item of items) {
          if (/^#?[0-9a-fA-F]{6}$/.test(item)) return item.startsWith('#') ? item : '#' + item;
          if (lineColorMap[item]) return lineColorMap[item];
          const compact = item.replace(/\s+/g, '');
          if (lineColorMap[compact]) return lineColorMap[compact];
        }
      }
      return '#4B8BFF';
    }

    function resolveLineName(tags = {}) {
      return tags['name:ko'] || tags.name || tags.ref || tags.line || tags.route || '지하철';
    }

    function normalizeLineName(name = '') {
      return String(name || '').replace(/\s+/g, ' ').trim();
    }

    function isExcludedUrbanRail(tags = {}) {
      const text = [
        tags['name:ko'], tags.name, tags.ref, tags.network, tags.operator, tags.brand, tags.description
      ].filter(Boolean).join(' ');
      return /(월미바다열차|월미은하레일|자기부상열차|관광열차|관광\s*모노레일|케이블카|삭도)/i.test(text);
    }

    function datasetRegionalCoverage(data = {}) {
      const stations = Array.isArray(data.stations) ? data.stations : [];
      const inBox = (station, south, west, north, east) => {
        const lat = Number(station.lat);
        const lon = Number(station.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) && lat >= south && lat <= north && lon >= west && lon <= east;
      };
      return {
        capital: stations.filter(s => inBox(s, 36.6, 126.0, 38.5, 128.2)).length,
        busan: stations.filter(s => inBox(s, 34.9, 128.65, 35.45, 129.35)).length,
        daegu: stations.filter(s => inBox(s, 35.75, 128.35, 36.05, 128.85)).length,
        daejeon: stations.filter(s => inBox(s, 36.20, 127.20, 36.50, 127.55)).length,
        gwangju: stations.filter(s => inBox(s, 35.05, 126.70, 35.30, 127.00)).length,
      };
    }

    function datasetHasNationalCoverage(data = {}) {
      const coverage = datasetRegionalCoverage(data);
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const lineText = lines.map(line => String(line.name || '')).join(' ');
      const hasLine = (pattern) => pattern.test(lineText);
      return (
        coverage.capital >= 50 &&
        (coverage.busan >= 8 || hasLine(/부산|동해|김해/i)) &&
        (coverage.daegu >= 5 || hasLine(/대구/i)) &&
        (coverage.daejeon >= 3 || hasLine(/대전/i)) &&
        (coverage.gwangju >= 3 || hasLine(/광주/i))
      );
    }

    function isUsableSubwayDataset(data) {
      // 수도권만 들어간 캐시가 최신으로 남아 있으면 부산/대구/대전/광주가 계속 안 뜬다.
      // 전체 노선 수 + 지역 커버리지까지 확인한 데이터만 정상 캐시로 인정한다.
      return !!(
        data &&
        Array.isArray(data.lines) && data.lines.length >= 10 &&
        Array.isArray(data.stations) && data.stations.length >= 20 &&
        datasetHasNationalCoverage(data)
      );
    }

    function parseCached() {
      try {
        let best = null;
        CACHE_KEYS.forEach((cacheKey) => {
          const raw = localStorage.getItem(cacheKey);
          if (!raw) return;
          try {
            const cached = JSON.parse(raw);
            if (!cached || !cached.timestamp || !cached.data) return;
            if (!isUsableSubwayDataset(cached.data)) {
              // 이전 빌드에서 생긴 fallback-only 캐시 정리
              try { localStorage.removeItem(cacheKey); } catch (_) { /* ignore */ }
              return;
            }
            if (!best || cached.timestamp > best.timestamp) best = cached;
          } catch (itemError) {
            console.warn('subway cache item parse failed', cacheKey, itemError);
            try { localStorage.removeItem(cacheKey); } catch (_) { /* ignore */ }
          }
        });
        if (!best) return null;
        return { data: best.data, expired: Date.now() - best.timestamp > CACHE_TTL, timestamp: best.timestamp };
      } catch (error) {
        console.warn('subway cache parse failed', error);
        return null;
      }
    }

    function storeCache(data) {
      try {
        if (!isUsableSubwayDataset(data)) return;
        const payload = JSON.stringify({ timestamp: Date.now(), data });
        // 동일한 대용량 데이터를 여러 키에 중복 저장하지 않아 모바일 메모리 스파이크를 줄인다.
        localStorage.setItem(CACHE_KEYS[0], payload);
        CACHE_KEYS.slice(1).forEach((cacheKey) => {
          try { localStorage.removeItem(cacheKey); } catch (_) { /* ignore */ }
        });
        window.KR_SUBWAY_OVERLAY_DATA = data;
      } catch (error) {
        console.warn('subway cache store failed', error);
      }
    }

    // 병합 비교용 키: 괄호 제거 + 역 제거
    function getStationLabelKey(name = '') {
      return String(name).trim()
        .replace(/\s*[\(（][^\)）]*[\)）]/g, '')
        .replace(/역$/, '')
        .replace(/[\s\u00A0\u200B\u200C\u200D_.·ㆍ-]+/g, '')
        .trim();
    }

    // 표시용 이름: 괄호 제거 + 역 suffix 보장
    function normalizeStationDisplayName(name = '') {
      const cleaned = String(name).trim()
        .replace(/\s*[\(（][^\)）]*[\)）]/g, '')
        .replace(/역$/, '')
        .replace(/[\u00A0\u200B\u200C\u200D]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned ? cleaned + '역' : '';
    }

    function getStationRenderKey(station) {
      const nameKey = getStationLabelKey(station && (station.displayName || station.name || ''));
      const lat = Number(station && station.lat);
      const lon = Number(station && station.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return nameKey || '';
      // 약 10m 단위로 묶어 동일 위치에 같은 이름 라벨이 2개 쌓이는 현상을 최종 렌더링 단계에서 한 번 더 차단한다.
      return nameKey + ':' + lat.toFixed(4) + ':' + lon.toFixed(4);
    }

    function getStationDistanceMeters(a, b) {
      const avgLat = (((a && a.lat) || 0) + ((b && b.lat) || 0)) / 2;
      const latScale = 111320;
      const lonScale = Math.cos(Cesium.Math.toRadians(avgLat)) * 111320;
      const dx = (((a && a.lon) || 0) - ((b && b.lon) || 0)) * lonScale;
      const dy = (((a && a.lat) || 0) - ((b && b.lat) || 0)) * latScale;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // 노선 색상 점 canvas 생성 (각 노선 색상 원) — HiDPI 지원
    function makeLineDotsCanvas(lines) {
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const isMobile = isMobileDevice();
        const dotR = isMobile ? 4 : 5; // 모바일에서 작게
        const gap = 3;
        const n = lines.length;
        const logW = n * (dotR * 2) + Math.max(0, n - 1) * gap;
        const logH = dotR * 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(Math.ceil(logW * dpr), 1);
        canvas.height = Math.max(Math.ceil(logH * dpr), 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.scale(dpr, dpr);
        lines.forEach((l, i) => {
          const cx = i * (dotR * 2 + gap) + dotR;
          ctx.beginPath();
          ctx.arc(cx, dotR, dotR - 0.8, 0, Math.PI * 2);
          ctx.fillStyle = l.color || '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#0a1020';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        return canvas;
      } catch (e) {
        console.warn('makeLineDotsCanvas failed:', e);
        return null;
      }
    }

    // canvas 캐시: 동일 색상 조합은 재사용 (매번 DOM 생성 방지)
    const dotsCanvasCache = new Map();

    function makeLineDotsCanvasCached(lines) {
      const key = lines.map(l => (l.color || '#4B8BFF').toLowerCase()).join('|');
      if (dotsCanvasCache.has(key)) return dotsCanvasCache.get(key);
      const canvas = makeLineDotsCanvas(lines);
      if (canvas) dotsCanvasCache.set(key, canvas);
      return canvas;
    }

    function normalizeRailMatchKey(value = '') {
      return String(value || '')
        .replace(/[·ㆍ\-_/\s]/g, '')
        .replace(/수인분당/g, '수인분당')
        .replace(/공항철도선/g, '공항철도')
        .toLowerCase();
    }

    function normalizeColorKey(value = '') {
      return String(value || '').trim().toLowerCase();
    }

    function railNameLooksSame(a = '', b = '') {
      const ak = normalizeRailMatchKey(a);
      const bk = normalizeRailMatchKey(b);
      if (!ak || !bk) return false;
      return ak === bk || ak.includes(bk) || bk.includes(ak);
    }

    function lineGeometryMatchesStationLine(geom, stationLine) {
      if (!geom || !stationLine) return false;
      const geomColor = normalizeColorKey(geom.color);
      const stationColor = normalizeColorKey(stationLine.color);
      if (geomColor && stationColor && geomColor === stationColor) return true;
      return railNameLooksSame(geom.name, stationLine.line);
    }

    function distanceBetweenLinePoints(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
      const aLon = Number(a[0]);
      const aLat = Number(a[1]);
      const bLon = Number(b[0]);
      const bLat = Number(b[1]);
      if (![aLon, aLat, bLon, bLat].every(Number.isFinite)) return Infinity;
      const avgLat = (aLat + bLat) / 2;
      const dx = (aLon - bLon) * Math.cos(Cesium.Math.toRadians(avgLat)) * 111320;
      const dy = (aLat - bLat) * 111320;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function sanitizeLinePositions(positions = []) {
      const result = [];
      (Array.isArray(positions) ? positions : []).forEach((point) => {
        if (!Array.isArray(point) || point.length < 2) return;
        const lon = Number(point[0]);
        const lat = Number(point[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        const next = [lon, lat];
        const prev = result[result.length - 1];
        if (prev && distanceBetweenLinePoints(prev, next) < 3) return;
        result.push(next);
      });
      return result;
    }

    function repairKnownLinePositions(lineName = '', positions = []) {
      const normalizedName = normalizeRailMatchKey(lineName);
      if (normalizedName.includes('공항철도')) {
        // 공항철도는 영종역이 터미널 뒤로 섞이면 인천공항 구간에 긴 대각선/갈라짐이 생긴다.
        // 실제 운행 순서 기준으로 고정한다.
        return [
          [126.972559, 37.554648],
          [126.951592, 37.544018],
          [126.925381, 37.557192],
          [126.900984, 37.576646],
          [126.8243724, 37.5669356],
          [126.801058, 37.562434],
          [126.735637, 37.571462],
          [126.673728, 37.569104],
          [126.625327, 37.555878],
          [126.523700, 37.511466],
          [126.493790, 37.492904],
          [126.476241, 37.458366],
          [126.452508, 37.447464],
          [126.433700, 37.468700]
        ];
      }
      if (normalizedName === '3호선' || normalizedName === '서울3호선' || normalizedName === '수도권3호선') {
        // 수도권 3호선만 고양 구간 순서를 보정한다.
        // 이전 조건이 부산3호선/대구3호선까지 서울 3호선으로 덮어써서 지역 노선이 사라지는 문제가 있었다.
        return [
          [126.747569, 37.676087],
          [126.761334, 37.670072],
          [126.773359, 37.659477],
          [126.77762, 37.652206],
          [126.78787, 37.643114],
          [126.811024, 37.631626],
          [126.83265, 37.634592],
          [126.843041, 37.653324],
          [126.872642, 37.650658],
          [126.895558, 37.653083],
          [126.913951, 37.648048],
          [126.918821, 37.636763],
          [126.921008, 37.619001],
          [126.929887, 37.610469],
          [126.935756, 37.600927],
          [126.943736, 37.589066],
          [126.950291, 37.582299],
          [126.957748, 37.574571],
          [126.97353, 37.575762],
          [126.985443, 37.576477],
          [126.991806, 37.571607],
          [126.99191, 37.566295],
          [126.99428, 37.561243],
          [127.005602, 37.559052],
          [127.010655, 37.55434],
          [127.015872, 37.548034],
          [127.017965, 37.540685],
          [127.028461, 37.527072],
          [127.020114, 37.516334],
          [127.01122, 37.512759],
          [127.004943, 37.50481],
          [127.01408, 37.493415],
          [127.016189, 37.485013],
          [127.034631, 37.484147],
          [127.046769, 37.486947],
          [127.055381, 37.490858],
          [127.063642, 37.494612],
          [127.070594, 37.496663],
          [127.079532, 37.493514],
          [127.08439, 37.483681],
          [127.10188, 37.487371],
          [127.118234, 37.492522],
          [127.12454, 37.495918],
          [127.128111, 37.502162]
        ];
      }
      return positions;
    }

    function splitLineIntoRenderableSegments(line) {
      const positions = Array.isArray(line && line.positions) ? line.positions : [];
      if (positions.length < 2) return [];
      const MAX_CONTINUOUS_SEGMENT_METERS = 20000;
      const segments = [];
      let current = [positions[0]];
      for (let i = 1; i < positions.length; i += 1) {
        const prev = positions[i - 1];
        const next = positions[i];
        const jump = distanceBetweenLinePoints(prev, next);
        if (jump > MAX_CONTINUOUS_SEGMENT_METERS) {
          if (current.length >= 2) segments.push({ ...line, positions: current });
          current = [next];
        } else {
          current.push(next);
        }
      }
      if (current.length >= 2) segments.push({ ...line, positions: current });
      return segments;
    }

    function buildSubwayLineGeometries(lines = []) {
      return (Array.isArray(lines) ? lines : [])
        .map((line) => {
          const rawPositions = sanitizeLinePositions(line.positions || []);
          const positions = repairKnownLinePositions(line.name || '지하철', rawPositions);
          return {
            name: line.name || '지하철',
            color: line.color || '#4B8BFF',
            positions: sanitizeLinePositions(positions),
          };
        })
        .filter((line) => line.positions.length >= 2);
    }

    function toLocalMeters(lon, lat, refLat) {
      const lonScale = Math.cos(Cesium.Math.toRadians(refLat || lat || 37)) * 111320;
      return { x: lon * lonScale, y: lat * 111320, lonScale };
    }

    function fromLocalMeters(x, y, refLat) {
      const lonScale = Math.cos(Cesium.Math.toRadians(refLat || 37)) * 111320;
      return { lon: x / lonScale, lat: y / 111320 };
    }

    function projectPointToSegmentMeters(point, a, b) {
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      if (len2 <= 0.000001) {
        const dx = point.x - a.x;
        const dy = point.y - a.y;
        return { x: a.x, y: a.y, t: 0, dist: Math.sqrt(dx * dx + dy * dy) };
      }
      const rawT = ((point.x - a.x) * vx + (point.y - a.y) * vy) / len2;
      const t = Math.max(0, Math.min(1, rawT));
      const x = a.x + vx * t;
      const y = a.y + vy * t;
      const dx = point.x - x;
      const dy = point.y - y;
      return { x, y, t, dist: Math.sqrt(dx * dx + dy * dy) };
    }

    function findClosestProjectionOnLine(station, geom) {
      if (!geom || !Array.isArray(geom.positions) || geom.positions.length < 2) return null;
      const refLat = Number(station.lat) || 37;
      const target = toLocalMeters(Number(station.lon), Number(station.lat), refLat);
      let best = null;
      for (let i = 0; i < geom.positions.length - 1; i++) {
        const aRaw = geom.positions[i];
        const bRaw = geom.positions[i + 1];
        const a = toLocalMeters(aRaw[0], aRaw[1], refLat);
        const b = toLocalMeters(bRaw[0], bRaw[1], refLat);
        const projected = projectPointToSegmentMeters(target, a, b);
        if (!best || projected.dist < best.dist) {
          const lonLat = fromLocalMeters(projected.x, projected.y, refLat);
          best = {
            lon: lonLat.lon,
            lat: lonLat.lat,
            dist: projected.dist,
            t: projected.t,
            segmentIndex: i,
            line: geom,
          };
        }
      }
      return best;
    }

    function findClosestProjection(station, lineGeometries) {
      let best = null;
      (Array.isArray(lineGeometries) ? lineGeometries : []).forEach((geom) => {
        const projected = findClosestProjectionOnLine(station, geom);
        if (projected && (!best || projected.dist < best.dist)) best = projected;
      });
      return best;
    }

    function getStationCandidateLines(station, lineGeometries, stationLineOverride = null) {
      const stationLines = stationLineOverride ? [stationLineOverride] : (Array.isArray(station.lines) ? station.lines : []);
      const candidates = (lineGeometries || []).filter((geom) => stationLines.some((line) => lineGeometryMatchesStationLine(geom, line)));
      return candidates.length > 0 ? candidates : (lineGeometries || []);
    }

    function segmentIntersectionMeters(a, b, c, d) {
      const rX = b.x - a.x;
      const rY = b.y - a.y;
      const sX = d.x - c.x;
      const sY = d.y - c.y;
      const denom = rX * sY - rY * sX;
      if (Math.abs(denom) < 0.000001) return null;
      const qpx = c.x - a.x;
      const qpy = c.y - a.y;
      const t = (qpx * sY - qpy * sX) / denom;
      const u = (qpx * rY - qpy * rX) / denom;
      const eps = 0.000001;
      if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
      return { x: a.x + t * rX, y: a.y + t * rY, t, u };
    }

    function findBestTransferIntersection(station, lineGroups) {
      if (!Array.isArray(lineGroups) || lineGroups.length < 2) return null;
      const refLat = Number(station.lat) || 37;
      const target = toLocalMeters(Number(station.lon), Number(station.lat), refLat);
      let best = null;
      for (let groupAIndex = 0; groupAIndex < lineGroups.length - 1; groupAIndex++) {
        for (let groupBIndex = groupAIndex + 1; groupBIndex < lineGroups.length; groupBIndex++) {
          const groupA = lineGroups[groupAIndex] || [];
          const groupB = lineGroups[groupBIndex] || [];
          groupA.forEach((lineA) => {
            groupB.forEach((lineB) => {
              if (!lineA || !lineB || lineA === lineB) return;
              for (let i = 0; i < lineA.positions.length - 1; i++) {
                const a = toLocalMeters(lineA.positions[i][0], lineA.positions[i][1], refLat);
                const b = toLocalMeters(lineA.positions[i + 1][0], lineA.positions[i + 1][1], refLat);
                for (let j = 0; j < lineB.positions.length - 1; j++) {
                  const c = toLocalMeters(lineB.positions[j][0], lineB.positions[j][1], refLat);
                  const d = toLocalMeters(lineB.positions[j + 1][0], lineB.positions[j + 1][1], refLat);
                  const intersection = segmentIntersectionMeters(a, b, c, d);
                  if (!intersection) continue;
                  const dx = target.x - intersection.x;
                  const dy = target.y - intersection.y;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  if (!best || dist < best.dist) {
                    const lonLat = fromLocalMeters(intersection.x, intersection.y, refLat);
                    best = { lon: lonLat.lon, lat: lonLat.lat, dist };
                  }
                }
              }
            });
          });
        }
      }
      return best;
    }

    function forceLineGeometryThroughPoint(projection, point) {
      // 노선 선형은 원본 정적 데이터 그대로 유지한다.
      // 이전 방식처럼 역 스냅을 위해 polyline 좌표를 강제로 삽입/이동하면,
      // 근접 노선을 잘못 후보로 잡았을 때 하늘색 노선이 2갈래로 갈라져 보이는 부작용이 발생한다.
      return;
    }

    function snapMergedStationsToSubwayLines(mergedStations, lineGeometries) {
      const MAX_STATION_SNAP_METERS = 1300;
      const MAX_TRANSFER_FIX_METERS = 1800;
      (Array.isArray(mergedStations) ? mergedStations : []).forEach((station) => {
        const stationLines = (Array.isArray(station.lines) ? station.lines : [])
          .filter((line) => line && (line.line || line.color));

        if (stationLines.length >= 2) {
          const lineGroups = stationLines.map((lineInfo) => getStationCandidateLines(station, lineGeometries, lineInfo));
          const intersection = findBestTransferIntersection(station, lineGroups);
          if (intersection && intersection.dist <= MAX_TRANSFER_FIX_METERS) {
            station.lon = intersection.lon;
            station.lat = intersection.lat;
            lineGroups.forEach((group) => {
              const best = findClosestProjection(station, group);
              if (best && best.dist <= MAX_STATION_SNAP_METERS) forceLineGeometryThroughPoint(best, station);
            });
            return;
          }

          const closestByLine = stationLines
            .map((lineInfo) => findClosestProjection(station, getStationCandidateLines(station, lineGeometries, lineInfo)))
            .filter((projection) => projection && projection.dist <= MAX_TRANSFER_FIX_METERS);

          if (closestByLine.length >= 2) {
            const averaged = closestByLine.reduce((acc, item) => {
              acc.lon += item.lon;
              acc.lat += item.lat;
              return acc;
            }, { lon: 0, lat: 0 });
            averaged.lon /= closestByLine.length;
            averaged.lat /= closestByLine.length;
            if (getStationDistanceMeters(station, averaged) <= MAX_TRANSFER_FIX_METERS) {
              station.lon = averaged.lon;
              station.lat = averaged.lat;
              closestByLine.forEach((projection) => forceLineGeometryThroughPoint(projection, station));
              return;
            }
          }
        }

        const candidates = getStationCandidateLines(station, lineGeometries);
        const bestProjection = findClosestProjection(station, candidates);
        if (bestProjection && bestProjection.dist <= MAX_STATION_SNAP_METERS) {
          station.lon = bestProjection.lon;
          station.lat = bestProjection.lat;
        }
      });
    }

    function normalizeLineIdentity(line = {}) {
      const color = String(line.color || '').trim().toLowerCase().replace(/\s+/g, '');
      const name = normalizeLineName(line.line || line.name || '').trim();
      return color || normalizeRailMatchKey(name) || name;
    }

    function pushUniqueStationLine(lines, lineInfo) {
      if (!lineInfo) return false;
      const color = lineInfo.color || '#4B8BFF';
      const lineName = normalizeLineName(lineInfo.line || lineInfo.name || '');
      if (!color || color === '#ffffff' || color === '#4B8BFF') return false;
      const next = { line: lineName || lineInfo.name || '', color };
      const nextKey = normalizeLineIdentity(next);
      const exists = (Array.isArray(lines) ? lines : []).some((item) => {
        const itemKey = normalizeLineIdentity(item);
        if (nextKey && itemKey && nextKey === itemKey) return true;
        return normalizeColorKey(item.color) === normalizeColorKey(next.color) || railNameLooksSame(item.line, next.line);
      });
      if (exists) return false;
      lines.push(next);
      return true;
    }

    function enrichTransferStationLinesByGeometry(mergedStations, lineGeometries) {
      if (!Array.isArray(mergedStations) || !Array.isArray(lineGeometries)) return;
      const MAX_TRANSFER_LINE_NEAR_METERS = 95;
      mergedStations.forEach((station) => {
        if (!station || !Number.isFinite(Number(station.lon)) || !Number.isFinite(Number(station.lat))) return;
        station.lines = Array.isArray(station.lines) ? station.lines : [];
        const nearLines = [];
        lineGeometries.forEach((geom) => {
          if (!geom || !Array.isArray(geom.positions) || geom.positions.length < 2) return;
          const projected = findClosestProjectionOnLine(station, geom);
          if (!projected || projected.dist > MAX_TRANSFER_LINE_NEAR_METERS) return;
          const lineInfo = { line: geom.name || '', color: geom.color || resolveColor({ name: geom.name || '' }) };
          const id = normalizeLineIdentity(lineInfo);
          if (!id) return;
          const existingNear = nearLines.find((item) => item.id === id || normalizeColorKey(item.color) === normalizeColorKey(lineInfo.color));
          if (existingNear) {
            if (projected.dist < existingNear.dist) existingNear.dist = projected.dist;
            return;
          }
          nearLines.push({ id, line: lineInfo.line, color: lineInfo.color, dist: projected.dist });
        });

        // 이미 데이터상 환승역으로 확인된 경우에만 주변 노선으로 누락 색상을 보강한다.
        // 단일역 주변을 우연히 지나는 다른 선로를 환승으로 오인하면 숙대입구역처럼
        // 점/라벨이 여러 개처럼 보이고 노선까지 분기된 것처럼 보이는 문제가 생긴다.
        const knownCount = station.lines.length;
        const shouldEnrich = knownCount >= 2;
        if (!shouldEnrich) return;
        nearLines
          .sort((a, b) => a.dist - b.dist)
          .forEach((item) => pushUniqueStationLine(station.lines, item));
      });
    }


    function normalizeStationLineList(lines) {
      const result = [];
      (Array.isArray(lines) ? lines : []).forEach((line) => pushUniqueStationLine(result, line));
      return result;
    }

    function stationLineSetsOverlap(aLines = [], bLines = []) {
      const a = normalizeStationLineList(aLines);
      const b = normalizeStationLineList(bLines);
      if (a.length === 0 || b.length === 0) return true;
      return a.some((left) => b.some((right) => {
        const leftKey = normalizeLineIdentity(left);
        const rightKey = normalizeLineIdentity(right);
        if (leftKey && rightKey && leftKey === rightKey) return true;
        if (normalizeColorKey(left.color) && normalizeColorKey(left.color) === normalizeColorKey(right.color)) return true;
        return railNameLooksSame(left.line, right.line);
      }));
    }

    function mergeStationMarker(target, source) {
      const targetWeight = Number(target._mergeWeight || 1);
      const sourceWeight = Number(source._mergeWeight || 1);
      const totalWeight = targetWeight + sourceWeight;
      target.lon = ((Number(target.lon) * targetWeight) + (Number(source.lon) * sourceWeight)) / totalWeight;
      target.lat = ((Number(target.lat) * targetWeight) + (Number(source.lat) * sourceWeight)) / totalWeight;
      target._mergeWeight = totalWeight;
      (Array.isArray(source.lines) ? source.lines : []).forEach((line) => pushUniqueStationLine(target.lines, line));
      target.lines = normalizeStationLineList(target.lines);
      target.displayName = normalizeStationDisplayName(target.name || source.name || target.displayName);
    }

    function consolidateDuplicateStationMarkers(mergedStations, lineGeometries) {
      if (!Array.isArray(mergedStations)) return;
      // OSM/Overpass는 일반역도 승강장·정차 위치·출입구가 각각 들어와 같은 역명이 2개 점으로 보일 수 있다.
      // 같은 역명 + 가까운 위치 + 같은 노선 계열이면 하나의 역 마커로 합쳐서 단일 노선 일반역은 항상 점 1개만 남긴다.
      const SAME_LINE_DUPLICATE_RADIUS_METERS = 1600;
      const TRANSFER_DUPLICATE_RADIUS_METERS = 900;
      for (let i = 0; i < mergedStations.length; i++) {
        const base = mergedStations[i];
        if (!base) continue;
        base.lines = normalizeStationLineList(base.lines);
        base._mergeWeight = base._mergeWeight || 1;
        for (let j = mergedStations.length - 1; j > i; j--) {
          const other = mergedStations[j];
          if (!other || base.key !== other.key) continue;
          other.lines = normalizeStationLineList(other.lines);
          const dist = getStationDistanceMeters(base, other);
          const sameLineLike = stationLineSetsOverlap(base.lines, other.lines);
          const radius = sameLineLike ? SAME_LINE_DUPLICATE_RADIUS_METERS : TRANSFER_DUPLICATE_RADIUS_METERS;
          if (dist > radius) continue;
          mergeStationMarker(base, other);
          mergedStations.splice(j, 1);
        }
      }

      // 최종 안전장치: 이름 키가 같거나 표시명이 같은 역이 매우 가까우면 한 번 더 병합한다.
      for (let i = mergedStations.length - 1; i >= 0; i--) {
        const current = mergedStations[i];
        if (!current) continue;
        for (let j = 0; j < i; j++) {
          const target = mergedStations[j];
          if (!target) continue;
          const sameName = current.key === target.key || getStationLabelKey(current.displayName || current.name) === getStationLabelKey(target.displayName || target.name);
          if (!sameName) continue;
          if (getStationDistanceMeters(current, target) > 120) continue;
          mergeStationMarker(target, current);
          mergedStations.splice(i, 1);
          break;
        }
      }

      mergedStations.forEach((station) => {
        station.lines = normalizeStationLineList(station.lines);
        delete station._mergeWeight;
      });

      // 합친 좌표가 선형 사이의 중간에 있을 수 있으므로 마지막으로 한 번 더 역 좌표만 노선 위로 스냅한다.
      // 노선 polyline 자체는 건드리지 않는다.
      snapMergedStationsToSubwayLines(mergedStations, lineGeometries);
    }

    function findClosestLineEndpoint(station, geom) {
      if (!geom || !Array.isArray(geom.positions) || geom.positions.length < 1) return null;
      const first = geom.positions[0];
      const last = geom.positions[geom.positions.length - 1];
      const candidates = [];
      if (first) candidates.push({ lon: first[0], lat: first[1] });
      if (last && (!first || last[0] !== first[0] || last[1] !== first[1])) candidates.push({ lon: last[0], lat: last[1] });
      let best = null;
      candidates.forEach((point) => {
        const dist = getStationDistanceMeters(station, point);
        if (!best || dist < best.dist) best = { ...point, dist };
      });
      return best;
    }

    function buildShortStationConnectors(mergedStations, lineGeometries) {
      const connectors = [];
      const seen = new Set();
      const MIN_CONNECT_METERS = 35;
      const MAX_CONNECT_METERS = 360;
      (Array.isArray(mergedStations) ? mergedStations : []).forEach((station) => {
        const stationLines = normalizeStationLineList(station.lines || []);
        if (stationLines.length < 2) return;
        stationLines.forEach((lineInfo) => {
          const candidates = getStationCandidateLines(station, lineGeometries, lineInfo);
          let best = null;
          candidates.forEach((geom) => {
            if (!lineGeometryMatchesStationLine(geom, lineInfo)) return;
            const endpoint = findClosestLineEndpoint(station, geom);
            if (endpoint && (!best || endpoint.dist < best.dist)) best = { ...endpoint, line: geom };
          });
          if (!best || best.dist < MIN_CONNECT_METERS || best.dist > MAX_CONNECT_METERS) return;
          const key = [station.key || station.name, normalizeLineIdentity(lineInfo), best.lon.toFixed(5), best.lat.toFixed(5)].join('|');
          if (seen.has(key)) return;
          seen.add(key);
          connectors.push({
            name: lineInfo.line || (best.line && best.line.name) || '지하철',
            color: lineInfo.color || (best.line && best.line.color) || '#4B8BFF',
            positions: [[Number(station.lon), Number(station.lat)], [best.lon, best.lat]],
          });
        });
      });
      return connectors;
    }

    function addEntities(dataset) {
      if (!dataset) return;
      // 새 데이터 로드 시 canvas 캐시 초기화
      dotsCanvasCache.clear();
      // suspendEvents: 수백 개 entity add를 배치 처리 — 내부 update 1회로 압축
      dataSource.entities.suspendEvents();
      try {
        dataSource.entities.removeAll();

        const lineGeometries = buildSubwayLineGeometries(dataset.lines || []);

        // ── 역 병합: 이름 + 근접도 기준 ──────────────────────────────
        const mergedStations = [];
        (dataset.stations || []).forEach((station) => {
          if (!Number.isFinite(station.lon) || !Number.isFinite(station.lat)) return;
          const labelKey = getStationLabelKey(station.name);
          if (!labelKey) return;

          const existing = mergedStations.find((item) => {
            if (item.key !== labelKey) return false;
            const dist = getStationDistanceMeters(item, station);
            return dist <= 400;
          });

          if (existing) {
            existing.lon = (existing.lon + station.lon) / 2;
            existing.lat = (existing.lat + station.lat) / 2;
            existing.displayName = normalizeStationDisplayName(existing.name);
            if (station.line && station.color && station.color !== '#ffffff' && station.color !== '#4B8BFF') {
              pushUniqueStationLine(existing.lines, { line: station.line, color: station.color });
            }
          } else {
            const firstLines = (station.line && station.color && station.color !== '#ffffff' && station.color !== '#4B8BFF')
              ? [{ line: station.line, color: station.color }]
              : [];
            mergedStations.push({
              key: labelKey,
              name: station.name || '',
              displayName: normalizeStationDisplayName(station.name),
              lon: station.lon,
              lat: station.lat,
              lines: firstLines,
            });
          }
        });

        // ── lines 배열 최종 정리: 색상 기준 중복 제거 ──
        mergedStations.forEach((s) => {
          const seenColors = new Set();
          s.lines = s.lines.filter((l) => {
            const key = (l.color || '').toLowerCase();
            if (seenColors.has(key)) return false;
            seenColors.add(key);
            return true;
          });
        });

        // ── mergedStations 자체 중복 제거 ──
        for (let i = mergedStations.length - 1; i >= 0; i--) {
          for (let j = 0; j < i; j++) {
            const a = mergedStations[j], b = mergedStations[i];
            if (a.key === b.key && getStationDistanceMeters(a, b) <= 400) {
              b.lines.forEach((l) => pushUniqueStationLine(a.lines, l));
              mergedStations.splice(i, 1);
              break;
            }
          }
        }

        // 역 마커를 노선 선형에 스냅한다.
        // 환승역은 가능한 경우 노선 교차점으로, 교차점이 없는 정적 데이터는 가장 가까운 각 노선 지점을 하나로 맞춰
        // 마커가 노선 밖으로 밀려 보이는 현상을 막는다.
        snapMergedStationsToSubwayLines(mergedStations, lineGeometries);
        enrichTransferStationLinesByGeometry(mergedStations, lineGeometries);
        consolidateDuplicateStationMarkers(mergedStations, lineGeometries);

        const renderLineSegments = [];
        lineGeometries.forEach((line) => {
          splitLineIntoRenderableSegments(line).forEach((segment) => renderLineSegments.push(segment));
        });
        buildShortStationConnectors(mergedStations, lineGeometries).forEach((segment) => renderLineSegments.push(segment));

        renderLineSegments.forEach((line) => {
          if (!Array.isArray(line.positions) || line.positions.length < 2) return;
          dataSource.entities.add({
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(line.positions.flat()),
              width: 5.0,
              material: Cesium.Color.fromCssColorString(line.color || '#4B8BFF').withAlpha(0.95),
              clampToGround: true,
            },
            properties: { kind: 'subway-line', name: line.name || '지하철' },
          });
        });

        if (window.WorldSearch && typeof window.WorldSearch.registerSubwayStations === 'function') {
          window.WorldSearch.registerSubwayStations(mergedStations.map((s) => ({
            ...s,
            name: s.displayName || normalizeStationDisplayName(s.name) || s.name,
            line: (s.lines[0] || {}).line || '',
            color: (s.lines[0] || {}).color || '#4B8BFF',
            zoom: 12,
            countryKo: '대한민국',
            countryEn: 'Korea',
            countryCode: 'KR',
          })));
        }

        // ── 렌더링 ────────────────────────────────────────────────────
        // matchMedia / NearFarScalar: 루프 밖에서 1회만 생성
        const _isMob = window.matchMedia('(max-width: 768px)').matches;
        const _labelScale = _isMob
          ? new Cesium.NearFarScalar(3000, 0.72, 600000, 0.4)
          : new Cesium.NearFarScalar(6000, 1.1, 600000, 0.5);
        const _labelTranslucency = new Cesium.NearFarScalar(10000, 1.0, 1800000, 0.0);
        const _billboardScale = _isMob
          ? new Cesium.NearFarScalar(3000, 0.75, 800000, 0.35)
          : new Cesium.NearFarScalar(6000, 1.1, 800000, 0.5);
        const _billboardTranslucency = new Cesium.NearFarScalar(10000, 1.0, 1200000, 0.0);
        const _labelOffset = new Cesium.Cartesian2(0, -26);
        const _billboardOffset = new Cesium.Cartesian2(0, 0);

        function pickPrimaryStationLine(lines) {
          const candidates = Array.isArray(lines) && lines.length > 0 ? lines : [{ line: '', color: '#4B8BFF' }];
          return candidates.find((line) => line && line.color && line.color !== '#ffffff' && line.color !== '#4B8BFF') || candidates[0] || { line: '', color: '#4B8BFF' };
        }

        const renderedStationKeys = new Set();
        mergedStations.forEach((station) => {
          const renderKey = getStationRenderKey(station);
          if (renderKey && renderedStationKeys.has(renderKey)) return;
          if (renderKey) renderedStationKeys.add(renderKey);
          const seenRenderColors = new Set();
          const dedupedLines = (station.lines.length > 0 ? station.lines : [{ line: '', color: '#4B8BFF' }])
            .filter((l) => {
              const k = (l.color || '#4B8BFF').toLowerCase().replace(/\s+/g, '');
              if (seenRenderColors.has(k)) return false;
              seenRenderColors.add(k);
              return true;
            });

          // 일반역은 1개 색상 점만 표시하고, 환승역은 해당되는 모든 노선 색상 점을 함께 표시한다.
          // 기존 중복 표시 문제는 위의 dedupe 단계에서 같은 노선/색상 반복을 제거해 방지한다.
          const markerLine = pickPrimaryStationLine(dedupedLines);
          const markerLines = dedupedLines.length > 1
            ? dedupedLines
            : [{ line: markerLine.line || '', color: markerLine.color || '#4B8BFF' }];
          const dotsCanvas = makeLineDotsCanvasCached(markerLines);
          // 모바일에서 새로고침 직후 지하철역 라벨/아이콘이 화면 좌표처럼 따라붙는 현상 방지.
          // 지형 클램프 대신 실제 WGS84 좌표에 고정해 카메라 이동 중에도 역 위치가 지도 좌표에 묶이도록 한다.
          const stationPosition = Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 35);

          dataSource.entities.add({
            position: stationPosition,
            label: {
              text: station.displayName || normalizeStationDisplayName(station.name) || '',
              font: 'bold 13px -apple-system, BlinkMacSystemFont, "Noto Sans KR", "Malgun Gothic", sans-serif',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.fromCssColorString('#0a1020'),
              outlineWidth: 4,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              pixelOffset: _labelOffset,
              heightReference: Cesium.HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: _labelScale,
              translucencyByDistance: _labelTranslucency,
            },
            properties: { kind: 'subway-station', name: station.name || '', line: dedupedLines.map(l => l.line).join(',') },
          });
          if (!dotsCanvas) return;
          dataSource.entities.add({
            position: stationPosition,
            billboard: {
              image: dotsCanvas,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              pixelOffset: _billboardOffset,
              heightReference: Cesium.HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: _billboardScale,
              translucencyByDistance: _billboardTranslucency,
            },
          });
        });
      } finally {
        // resumeEvents: 모든 add 완료 후 Cesium 내부 update 1회 발생
        dataSource.entities.resumeEvents();
      }
      viewer.scene.requestRender();
    }

    function isUrbanRailRelation(tags = {}) {
      const route = String(tags.route || '').toLowerCase();
      if (route === 'subway' || route === 'light_rail' || route === 'monorail') return true;
      if (route !== 'train') return false;
      const text = [tags.name, tags.ref, tags.network, tags.operator].filter(Boolean).join(' ');
      // 명확한 장거리 국가철도 키워드만 제외 (lookahead 없이)
      if (/\bKTX\b|\bITX\b|무궁화호|새마을호|누리로|경부고속선|호남고속선|경전선|장항선|충북선|태백선|영동선|정선선/i.test(text)) return false;
      // 도시철도·수도권 전철 포함
      return /(호선|공항철도|신분당|수인|분당|경의중앙|경춘|서해|신림|우이|김포|의정부|에버라인|인천[12]호선|부산[1-4]호선|대구[123]호선|대전[1]호선|광주[1]호선|GTX|도시철도|수도권 전철)/i.test(text);
    }

    function roleLooksLikeStation(role = '') {
      return /(stop|station|platform|halt|stop_entry_only|stop_exit_only)/i.test(String(role || ''));
    }

    function nodeLooksLikeStation(tags = {}) {
      if (isExcludedUrbanRail(tags)) return false;
      const railway = String(tags.railway || '').toLowerCase();
      const publicTransport = String(tags.public_transport || '').toLowerCase();
      const station = String(tags.station || '').toLowerCase();
      const text = [tags['name:ko'], tags.name, tags.network, tags.operator, tags.line, tags.ref].filter(Boolean).join(' ');
      return !!((tags['name:ko'] || tags.name) && (
        station === 'subway' || station === 'light_rail' || station === 'monorail' ||
        railway === 'station' || railway === 'halt' || railway === 'platform' ||
        publicTransport === 'station' || publicTransport === 'platform' || publicTransport === 'stop_position' ||
        /(공항철도|신분당|수인|분당|경의|중앙|경춘|서해|신림|우이|김포|의정부|에버|인천|부산|대구|대전|광주|동해|GTX|도시철도|수도권 전철|지하철)/i.test(text)
      ));
    }

    function relationText(tags = {}) {
      return [tags.name, tags.ref, tags.network, tags.operator].filter(Boolean).join(' ');
    }

    function centerFromGeometry(geometry) {
      if (!Array.isArray(geometry) || !geometry.length) return null;
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      geometry.forEach((pos) => {
        if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return;
        minLat = Math.min(minLat, pos.lat); maxLat = Math.max(maxLat, pos.lat);
        minLon = Math.min(minLon, pos.lon); maxLon = Math.max(maxLon, pos.lon);
      });
      if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
      return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
    }

    function addStationFromMember(stations, stationSeen, stationSeenByLoc, source, lineName, color) {
      if (!source) return;
      const tags = source.tags || {};
      const name = tags['name:ko'] || tags.name || tags.official_name || '';
      const point = Number.isFinite(source.lon) && Number.isFinite(source.lat)
        ? { lon: source.lon, lat: source.lat }
        : centerFromGeometry(source.geometry);
      if (!name || !point) return;
      const resolvedLine = lineName || tags.line || tags.ref || '';
      // 위치+이름 기준 전역 중복 방지 (노선명은 dedup key에서 제외 → 방향별 중복 relation 처리 시 같은 역 2번 추가 방지)
      const dedupeKey = name + ':' + point.lon.toFixed(4) + ':' + point.lat.toFixed(4);
      if (stationSeen.has(dedupeKey)) return;
      stationSeen.add(dedupeKey);
      // 이름 기준 중복 방지
      const locKey = name.replace(/역$/, '').trim();
      stationSeenByLoc.add(locKey);
      stations.push({ name, lon: point.lon, lat: point.lat, line: resolvedLine, color: color || resolveColor(tags) });
    }

    function transformOverpass(raw) {
      const elements = Array.isArray(raw && raw.elements) ? raw.elements : [];
      const nodeMap = new Map();
      const wayMap = new Map();
      const relationMap = new Map();
      elements.forEach((el) => {
        if (el.type === 'node') nodeMap.set(el.id, el);
        if (el.type === 'way') wayMap.set(el.id, el);
        if (el.type === 'relation') relationMap.set(el.id, el);
      });

      const selectedRelations = [];
      relationMap.forEach((relation) => {
        const tags = relation.tags || {};
        if (isUrbanRailRelation(tags)) selectedRelations.push(relation);
      });

      const lines = [];
      const stations = [];
      const stationSeen = new Set();       // name:line:lon:lat — 노선별 중복 방지
      const stationSeenByLoc = new Set();  // name:lon:lat — 위치 기준 중복 방지
      const selectedMemberNodeIds = new Set();

      selectedRelations.forEach((relation) => {
        const tags = relation.tags || {};
        if (isExcludedUrbanRail(tags)) return;
        const members = Array.isArray(relation.members) ? relation.members : [];
        const color = resolveColor(tags);
        const name = normalizeLineName(resolveLineName(tags) || relationText(tags) || '지하철');
        const segmentSeen = new Set();

        // 1패스: 역 먼저 수집
        const relationStations = [];
        members.forEach((member) => {
          if (member.type === 'node') {
            selectedMemberNodeIds.add(member.ref);
            const node = nodeMap.get(member.ref);
            if (node && (roleLooksLikeStation(member.role) || nodeLooksLikeStation(node.tags || {}))) {
              addStationFromMember(stations, stationSeen, stationSeenByLoc, node, name, color);
              if (Number.isFinite(node.lon) && Number.isFinite(node.lat)) {
                relationStations.push({ lon: node.lon, lat: node.lat });
              }
            }
          } else if (member.type === 'way') {
            const way = wayMap.get(member.ref);
            if (roleLooksLikeStation(member.role) && way) {
              addStationFromMember(stations, stationSeen, stationSeenByLoc, way, name, color);
              const c = centerFromGeometry(way.geometry);
              if (c) relationStations.push(c);
            }
          }
        });

        // 2패스: way 세그먼트 — 역 범위 내에 있는 것만 추가
        members.forEach((member) => {
          if (member.type !== 'way') return;
          const way = wayMap.get(member.ref);
          if (!way || !Array.isArray(way.geometry) || way.geometry.length < 2) return;
          if (roleLooksLikeStation(member.role)) return; // 역 플랫폼 way는 선로로 안 그림

          const positions = way.geometry
            .filter((pos) => Number.isFinite(pos.lon) && Number.isFinite(pos.lat))
            .map((pos) => [pos.lon, pos.lat]);
          if (positions.length < 2) return;
          const segKey = positions[0].join(',') + '|' + positions[positions.length - 1].join(',');
          const reverseKey = positions[positions.length - 1].join(',') + '|' + positions[0].join(',');
          if (segmentSeen.has(segKey) || segmentSeen.has(reverseKey)) return;
          segmentSeen.add(segKey);
          lines.push({ name, color, positions });
        });
      });

      // 관계에 포함된 노드 중 추가 누락분 보완 (이미 위치 기준으로 등록된 역은 스킵)
      elements.forEach((el) => {
        if (el.type !== 'node' || !Number.isFinite(el.lon) || !Number.isFinite(el.lat)) return;
        const tags = el.tags || {};
        if (!selectedMemberNodeIds.has(el.id) && !nodeLooksLikeStation(tags)) return;
        if (isExcludedUrbanRail(tags)) return;
        const name = tags['name:ko'] || tags.name || tags.official_name || '';
        if (!name) return;
        const locKey = name.replace(/역$/, '').trim();
        if (stationSeenByLoc.has(locKey)) return; // 이미 관계에서 등록된 역 → 스킵
        stationSeenByLoc.add(locKey);
        stations.push({
          name,
          lon: el.lon,
          lat: el.lat,
          line: tags.line || tags.ref || tags.route || '',
          color: resolveColor(tags),
        });
      });

      // 폴백 정적 데이터 (위치 기준으로 이미 있는 역은 스킵)
      const fallbackStations = Array.isArray(window.KR_SUBWAY_STATIONS) ? window.KR_SUBWAY_STATIONS : [];
      fallbackStations.forEach((station) => {
        if (!Number.isFinite(Number(station.lon)) || !Number.isFinite(Number(station.lat)) || !station.name) return;
        const locKey = String(station.name).replace(/역$/, '').trim();
        if (stationSeenByLoc.has(locKey)) return;
        stationSeenByLoc.add(locKey);
        if (isExcludedUrbanRail({ name: station.name || station.nameKo || '', ref: station.line || '' })) return;
        stations.push({
          name: station.name || station.nameKo || '',
          lon: Number(station.lon),
          lat: Number(station.lat),
          line: normalizeLineName(station.line || ''),
          color: station.color || resolveColor({ ref: station.line || '', name: station.line || '' }),
        });
      });

      return { lines, stations };
    }

    async function fetchOverpass(query) {
      const endpoints = [
        'https://overpass.kumi.systems/api/interpreter',
        DATA_URL,
        'https://z.overpass-api.de/api/interpreter',
        'https://overpass.osm.ch/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
      ];
      const timeoutMs = window.matchMedia('(max-width: 768px)').matches ? 75000 : 60000;
      const minElements = 20;

      async function requestEndpoint(endpoint) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('HTTP ' + response.status + ' @ ' + endpoint);
          const json = await response.json();
          if (!json || !Array.isArray(json.elements) || json.elements.length < minElements) {
            throw new Error('Overpass partial/empty response @ ' + endpoint);
          }
          return json;
        } finally {
          clearTimeout(timer);
        }
      }

      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (isMobile) {
        // 모바일은 동시 5개 요청을 피하고 순차 재시도한다. 새로고침/탭 종료 방지용.
        let lastError = null;
        for (const endpoint of endpoints) {
          try {
            return await requestEndpoint(endpoint);
          } catch (error) {
            lastError = error;
            console.warn('overpass endpoint failed:', endpoint, error);
          }
        }
        throw lastError || new Error('No overpass endpoint available');
      }

      const requests = endpoints.map((endpoint) => requestEndpoint(endpoint).catch((error) => {
        console.warn('overpass endpoint failed:', endpoint, error);
        throw error;
      }));
      if (typeof Promise.any === 'function') {
        return Promise.any(requests);
      }
      return new Promise((resolve, reject) => {
        let rejected = 0;
        let lastError = null;
        requests.forEach((request) => {
          request.then(resolve).catch((error) => {
            rejected += 1;
            lastError = error;
            if (rejected >= requests.length) reject(lastError || new Error('No overpass endpoint available'));
          });
        });
      });
    }

    function mergeSubwayDatasets(datasets = []) {
      const merged = { lines: [], stations: [] };
      const lineSeen = new Set();
      const stationSeen = new Set();
      datasets.forEach((dataset) => {
        if (!dataset) return;
        (Array.isArray(dataset.lines) ? dataset.lines : []).forEach((line) => {
          if (!Array.isArray(line.positions) || line.positions.length < 2) return;
          const first = line.positions[0] || [];
          const last = line.positions[line.positions.length - 1] || [];
          const key = [line.name || '', line.color || '', Number(first[0] || 0).toFixed(4), Number(first[1] || 0).toFixed(4), Number(last[0] || 0).toFixed(4), Number(last[1] || 0).toFixed(4), line.positions.length].join('|');
          if (lineSeen.has(key)) return;
          lineSeen.add(key);
          merged.lines.push({
            name: line.name || '지하철',
            color: line.color || resolveColor({ name: line.name || '' }),
            positions: line.positions.map(pos => [Number(pos[0]), Number(pos[1])]).filter(pos => Number.isFinite(pos[0]) && Number.isFinite(pos[1])),
          });
        });
        (Array.isArray(dataset.stations) ? dataset.stations : []).forEach((station) => {
          const name = station.name || station.nameKo || '';
          const lat = Number(station.lat);
          const lon = Number(station.lon);
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const normalizedLine = normalizeLineName(station.line || '');
          const resolvedColor = station.color || resolveColor({ ref: station.line || '', name: station.line || '' });
          // 환승역은 같은 좌표에 노선별 station row가 여러 개 들어오므로 line/color까지 키에 포함한다.
          // 여기서 이름+좌표만으로 제거하면 이후 렌더링 단계에서 환승 색상 점을 복구할 수 없다.
          const key = [getStationLabelKey(name), lat.toFixed(5), lon.toFixed(5), normalizeRailMatchKey(normalizedLine), normalizeColorKey(resolvedColor)].join(':');
          if (stationSeen.has(key)) return;
          stationSeen.add(key);
          merged.stations.push({
            name,
            lat,
            lon,
            line: normalizedLine,
            color: resolvedColor,
            aliases: Array.isArray(station.aliases) ? station.aliases.slice() : [],
          });
        });
      });
      return merged;
    }

    function getFallbackDataset() {
      const fallbackStations = Array.isArray(window.KR_SUBWAY_STATIONS) ? window.KR_SUBWAY_STATIONS : [];
      const staticOverlay = window.KR_SUBWAY_STATIC_OVERLAY || {};
      const regionalOverlay = window.KR_SUBWAY_REGIONAL_STATIC_OVERLAY || {};
      return mergeSubwayDatasets([
        {
          lines: Array.isArray(staticOverlay.lines) ? staticOverlay.lines : [],
          stations: Array.isArray(staticOverlay.stations) ? staticOverlay.stations : [],
        },
        {
          lines: Array.isArray(regionalOverlay.lines) ? regionalOverlay.lines : [],
          stations: Array.isArray(regionalOverlay.stations) ? regionalOverlay.stations : [],
        },
        { lines: [], stations: fallbackStations },
      ]);
    }

    function getRegionalSubwayQueries() {
      const baseSelector = `
(
  relation["type"="route"]["route"~"subway|light_rail|monorail"];
  relation["type"="route"]["route"="train"]["name"~"GTX|공항철도|신분당|수인|분당|경의|중앙|경춘|서해|신림|우이|김포|의정부|에버라인|인천|부산|대구|대전|광주|동해|도시철도|수도권 전철", i];
  node["railway"~"station|halt|platform"]["station"~"subway|light_rail|monorail"];
  node["public_transport"~"station|platform|stop_position"]["station"~"subway|light_rail|monorail"];
);
out body;
>;
out geom qt;`;
      const regions = [
        { name: 'capital', bbox: '36.6,126.0,38.5,128.2', timeout: 50 },
        { name: 'busan', bbox: '34.9,128.65,35.45,129.35', timeout: 40 },
        { name: 'daegu', bbox: '35.75,128.35,36.05,128.85', timeout: 35 },
        { name: 'daejeon', bbox: '36.20,127.20,36.50,127.55', timeout: 30 },
        { name: 'gwangju', bbox: '35.05,126.70,35.30,127.00', timeout: 30 },
      ];
      return regions.map(region => ({
        name: region.name,
        query: `[out:json][timeout:${region.timeout}][bbox:${region.bbox}];${baseSelector}`,
      }));
    }

    async function fetchRegionalOverpassDatasets() {
      const queries = getRegionalSubwayQueries();
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      const results = [];
      if (isMobile) {
        for (const item of queries) {
          try {
            const raw = await fetchOverpass(item.query);
            results.push(transformOverpass(raw));
          } catch (error) {
            console.warn('regional subway overpass failed:', item.name, error);
          }
        }
        return results;
      }
      const settled = await Promise.allSettled(queries.map(async (item) => {
        const raw = await fetchOverpass(item.query);
        return transformOverpass(raw);
      }));
      settled.forEach((item, index) => {
        if (item.status === 'fulfilled') results.push(item.value);
        else console.warn('regional subway overpass failed:', queries[index].name, item.reason);
      });
      return results;
    }

    let hasLoadedOnce = false;
    let loadPromise = null;

    async function load() {
      if (loadPromise) return loadPromise;
      loadPromise = (async () => {
        // ① 지하철 오버레이는 정적 번들 데이터만 즉시 표시한다.
        // 캐시/Overpass 원시 데이터는 노선 선형을 흔들 수 있으므로 이 렌더링 경로에서는 사용하지 않는다.
        try {
          const fallbackDataset = getFallbackDataset();
          if (((fallbackDataset.lines || []).length > 0) || ((fallbackDataset.stations || []).length > 0)) {
            addEntities(fallbackDataset);
            window.KR_SUBWAY_OVERLAY_DATA = fallbackDataset;
            hasLoadedOnce = true;
          }
        } catch (e) {
          console.warn('subway static load failed:', e);
        }

        // 정적 데이터 표시로 종료한다. 네트워크 갱신은 시각적 중복/분기 이슈 방지를 위해 비활성화한다.
        return;

        // ② Overpass 갱신 — 전국을 한 번에 조회하면 일부 서버가 수도권만 반환/타임아웃되는 경우가 있어
        // 수도권·부산·대구·대전·광주 bbox로 분리해서 병합한다.
        // 단, 모바일은 잦은 새로고침/백그라운드 탭 종료를 막기 위해 초기 표시를 정적 데이터로 끝내고
        // 네트워크 갱신은 사용자가 PC/넓은 화면에서 볼 때만 수행한다.
        if (window.matchMedia('(max-width: 768px)').matches && hasLoadedOnce) {
          return;
        }
        try {
          const fallbackDataset = getFallbackDataset();
          const regionalDatasets = await fetchRegionalOverpassDatasets();
          // Overpass는 역 누락 보완용으로만 사용한다. 원시 선로 way를 그대로 병합하면
          // 같은 노선의 상/하행 track 또는 relation 세그먼트가 겹쳐 2갈래 선처럼 보인다.
          // 노선 선형은 번들된 정적 데이터만 유지해 렌더링을 안정화한다.
          const overpassStationsOnly = regionalDatasets.map((dataset) => ({ lines: [], stations: dataset.stations || [] }));
          const transformed = mergeSubwayDatasets([fallbackDataset, ...overpassStationsOnly]);
          if (((transformed.lines || []).length > 0) || ((transformed.stations || []).length > 0)) {
            addEntities(transformed);
            if (isUsableSubwayDataset(transformed)) storeCache(transformed);
            hasLoadedOnce = true;
          } else {
            throw new Error('Korea subway data is empty; keeping current cache/fallback');
          }
        } catch (error) {
          console.warn('Korea subway Overpass failed, using fallback data:', error);
          // 폴백 데이터라도 있으면 로드 완료로 처리 → setVisible에서 즉시 표시
          if (dataSource.entities.values.length > 0) hasLoadedOnce = true;
        }
      })();
      try {
        await loadPromise;
      } finally {
        loadPromise = null;
      }
    }

    load();

    return {
      setVisible(visible) {
        if (!visible) {
          dataSource.show = false;
          viewer.scene.requestRender();
          return;
        }
        // visible = true
        if (hasLoadedOnce) {
          // 이미 완전한 데이터 로드 완료 → 즉시 표시
          dataSource.show = true;
          viewer.scene.requestRender();
        } else {
          // 모바일에서는 Overpass 백그라운드 갱신이 길어질 수 있으므로,
          // 이미 정적/캐시 엔티티가 들어와 있으면 즉시 표시한다.
          if (dataSource.entities.values.length > 0) {
            dataSource.show = true;
            viewer.scene.requestRender();
          }
          const showWhenReady = () => {
            dataSource.show = true;
            viewer.scene.requestRender();
          };
          load().then(showWhenReady, showWhenReady);
        }
      },
      reload() { return load(); },
    };
  }

  function configureScene(viewer) {
    const scene = viewer.scene;
    const globe = scene.globe;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    scene.globe.show = true;
    scene.globe.baseColor = Cesium.Color.BLACK;
    scene.globe.enableLighting = false;
    scene.globe.depthTestAgainstTerrain = false;
    // 타일 해상도: 모바일은 SSE 높여 타일 요청 수 대폭 절감 (트래픽 핵심)
    scene.globe.maximumScreenSpaceError = isMobile ? 2.8 : 2.2;
    scene.globe.preloadAncestors = true; // 모바일도 부모 타일을 유지해 흐릿한 타일 잔상을 줄인다
    scene.globe.loadingDescendantsLimit = isMobile ? 8 : 12;
    // 캐시: 모바일 메모리 절약, PC는 재다운로드 방지
    scene.globe.tileCacheSize = isMobile ? 180 : 320;
    scene.skyAtmosphere.show = false;
    scene.sun.show = false;
    scene.moon.show = false;
    scene.fog.enabled = false;
    scene.backgroundColor = Cesium.Color.BLACK;
    scene.highDynamicRange = false;
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Infinity;
    // fxaa 비활성화: 지도 뷰에서 체감 차이 없고 GPU 비용 절감
    if (scene.postProcessStages && scene.postProcessStages.fxaa) scene.postProcessStages.fxaa.enabled = false;
    scene.fxaa = false;

    // HiDPI 지원: 데스크탑 최대 1.75×, 모바일은 1.0 고정 (성능 우선)
    const dpr = window.devicePixelRatio || 1;
    viewer.resolutionScale = isMobile ? Math.min(dpr, 1.35) : Math.min(dpr, 1.5);
    viewer.targetFrameRate = isMobile ? 36 : 45;

    const controller = scene.screenSpaceCameraController;
    controller.maximumZoomDistance = HOME_VIEW.alt;
    controller.minimumZoomDistance = isMobile ? 120 : 500;
    controller.enableCollisionDetection = false;
    controller.maximumTiltAngle = Cesium.Math.toRadians(90);
    // 모바일: inertia 낮춰 포스트-이동 렌더 횟수 절감
    controller.inertiaSpin = isMobile ? 0.08 : 0.62;
    controller.inertiaTranslate = isMobile ? 0.15 : 0.7;
    controller.inertiaZoom = isMobile ? 0.10 : 0.64;
    controller.maximumMovementRatio = isMobile ? 0.12 : 0.16;
    controller.zoomFactor = isMobile ? 8.5 : 5.0;
    controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];

    // 모바일: camera.changed 이벤트 빈도 대폭 감소 (syncTopDownCamera, minimap 호출 줄임)
    viewer.camera.percentageChanged = isMobile ? 0.2 : 0.08;
  }

  function wireLoading(scene) {
    const loading = document.getElementById('loading');
    if (!loading) return;
    let dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      loading.classList.add('out');
      setTimeout(() => loading.classList.add('gone'), 700);
    }

    // ① 타일 로딩 완료 시 즉시 dismiss
    scene.globe.tileLoadProgressEvent.addEventListener(count => {
      if (count === 0) dismiss();
    });

    // ② 2초 후 타일 개수가 충분히 적으면 dismiss (requestRenderMode에서 count=0 미도달 방지)
    setTimeout(() => {
      // 타일이 아직 로딩 중이어도 화면에 지구가 보이면 dismiss
      if (!dismissed) dismiss();
    }, 2000);

    // ③ 어떤 경우에도 5초 후 강제 dismiss
    setTimeout(dismiss, 5000);
  }


  function wireImageryMetadata(viewer) {
    const card = document.getElementById('imagery-meta-card');
    const content = document.getElementById('imagery-meta-content');
    const closeBtn = document.getElementById('imagery-meta-close');
    const mobileBtn = document.getElementById('imagery-meta-mobile-btn');
    if (!card || !content || !viewer || !viewer.scene) return;

    const scene = viewer.scene;
    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    let queryToken = 0;

    function isMobileViewport() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function getApproxZoom() {
      const cameraPosition = viewer.camera && viewer.camera.positionCartographic;
      const height = cameraPosition ? cameraPosition.height : 18000000;
      const zoom = Math.round(19 - Math.log2(Math.max(1, height) / 300));
      return Math.max(0, Math.min(19, zoom));
    }

    function pickCartographic(screenPosition) {
      if (!screenPosition) return null;
      const ray = viewer.camera.getPickRay(screenPosition);
      const cartesian = (ray && scene.globe.pick(ray, scene)) || viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
      if (!cartesian) return null;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return null;
      return {
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lon: Cesium.Math.toDegrees(cartographic.longitude),
      };
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatDateNumber(value) {
      if (!value && value !== 0) return '';
      const raw = String(value).replace(/[^0-9]/g, '');
      if (raw.length !== 8) return '';
      return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
    }

    function formatArcgisDate(value, fallback) {
      if (value || value === 0) {
        if (typeof value === 'number') {
          const date = new Date(value);
          if (!Number.isNaN(date.getTime())) {
            return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
          }
        }
        const asNumber = Number(value);
        if (Number.isFinite(asNumber) && String(value).length > 8) {
          const date = new Date(asNumber);
          if (!Number.isNaN(date.getTime())) {
            return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
          }
        }
        const asDateText = formatDateNumber(value);
        if (asDateText) return asDateText;
      }
      return formatDateNumber(fallback) || '확인 불가';
    }

    function makeRow(label, value) {
      if (value == null || value === '') return '';
      return '<div class="im-row"><div class="im-k">' + escapeHtml(label) + '</div><div class="im-v">' + escapeHtml(value) + '</div></div>';
    }

    function positionCard(pointer) {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (isMobile) {
        // 우측 툴 아이콘/지구 버튼 터치 영역을 침범하지 않도록 오른쪽 여백을 고정 확보한다.
        card.style.left = '12px';
        card.style.left = 'calc(12px + env(safe-area-inset-left))';
        card.style.right = 'calc(78px + env(safe-area-inset-right))';
        card.style.top = 'auto';
        card.style.bottom = 'calc(124px + env(safe-area-inset-bottom))';
        card.style.width = 'auto';
        card.style.maxHeight = 'min(42dvh, 340px)';
        card.style.overflowY = 'auto';
        return;
      }
      card.style.right = 'auto';
      card.style.bottom = 'auto';
      card.style.maxHeight = '';
      card.style.overflowY = '';
      card.style.width = '292px';
      const width = card.offsetWidth || 292;
      const height = card.offsetHeight || 180;
      const left = Math.min(window.innerWidth - width - 12, Math.max(12, pointer.x + 14));
      const top = Math.min(window.innerHeight - height - 12, Math.max(12, pointer.y + 14));
      card.style.left = left + 'px';
      card.style.top = top + 'px';
    }

    function closeMetadataCard() {
      queryToken += 1;
      card.classList.remove('show');
    }

    window.closeImageryMetadataCard = closeMetadataCard;

    function showStatus(message, pointer) {
      content.className = 'im-status';
      content.textContent = message;
      card.classList.add('show');
      positionCard(pointer || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }

    function cleanKoreanAdminName(name) {
      return String(name || '')
        .replace('특별시', '')
        .replace('광역시', '')
        .replace('특별자치시', '')
        .replace('특별자치도', '')
        .replace('자치시', '')
        .replace('자치도', '')
        .trim();
    }

    function buildLocationInfo(place, lat, lon) {
      if (place && place.label) return place.label;
      const parts = [place && place.neighbourhood, place && place.district, place && place.city, place && place.country]
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const unique = [];
      parts.forEach(part => { if (!unique.includes(part)) unique.push(part); });
      return unique.join(' · ') || (lat.toFixed(5) + ', ' + lon.toFixed(5));
    }

    function buildArcgisLocationLabel(address, lat, lon) {
      const addr = address || {};
      const countryCode = String(addr.CountryCode || '').toUpperCase();
      const isKorea = countryCode === 'KOR' || countryCode === 'KR' || /대한민국|South Korea|Korea/i.test(String(addr.Country || addr.LongLabel || ''));
      let parts;
      if (isKorea) {
        parts = [
          addr.Address || addr.Neighborhood || addr.PlaceName,
          addr.District || addr.Subregion,
          cleanKoreanAdminName(addr.City || addr.Region),
        ];
      } else {
        parts = [
          addr.Address || addr.Neighborhood || addr.PlaceName,
          addr.City || addr.Subregion,
          addr.Region,
          addr.Country,
        ];
      }
      const unique = [];
      parts.map(value => String(value || '').trim()).filter(Boolean).forEach(part => {
        if (!unique.includes(part)) unique.push(part);
      });
      return unique.join(' · ') || (lat.toFixed(5) + ', ' + lon.toFixed(5));
    }

    async function resolveLocationInfo(lat, lon) {
      const coordText = lat.toFixed(5) + ', ' + lon.toFixed(5);
      try {
        const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&langCode=KO&location=' +
          encodeURIComponent(lon.toFixed(6) + ',' + lat.toFixed(6));
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (response.ok) {
          const json = await response.json();
          const label = buildArcgisLocationLabel(json && json.address, lat, lon);
          if (label) return label;
        }
      } catch (error) {
        console.warn('imagery metadata ArcGIS reverse geocode failed:', error);
      }
      try {
        if (window.WorldSearch && typeof window.WorldSearch.reverseGeocode === 'function') {
          return buildLocationInfo(await window.WorldSearch.reverseGeocode(lat, lon), lat, lon);
        }
      } catch (error) {
        console.warn('imagery metadata fallback reverse geocode failed:', error);
      }
      return coordText;
    }

    function showMetadata(attributes, lat, lon, zoom, pointer, locationInfo) {
      const dateText = formatArcgisDate(attributes.SRC_DATE2, attributes.SRC_DATE);
      const resolution = attributes.SRC_RES || attributes.SRC_RES === 0 ? Number(attributes.SRC_RES).toFixed(Number(attributes.SRC_RES) < 1 ? 2 : 1).replace(/\.0$/, '') + ' m' : '';
      content.className = '';
      content.innerHTML =
        '<div class="im-grid">' +
        makeRow('촬영일', dateText) +
        makeRow('해상도', resolution) +
        makeRow('위치', locationInfo || (lat.toFixed(5) + ', ' + lon.toFixed(5))) +
        makeRow('좌표', lat.toFixed(5) + ', ' + lon.toFixed(5)) +
        '</div>' +
        '<div class="im-note">위치 정보는 지도/지오코딩 데이터 기준이며 실제 행정구역과 일부 다를 수 있습니다.</div>';
      card.classList.add('show');
      positionCard(pointer);
    }

    function chooseBestFeature(features, zoom) {
      if (!Array.isArray(features) || !features.length) return null;
      const candidates = features
        .map(feature => feature && feature.attributes ? feature.attributes : null)
        .filter(Boolean)
        .filter(attributes => {
          const min = Number(attributes.MinMapLevel);
          const max = Number(attributes.MaxMapLevel);
          if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
          return zoom >= min && zoom <= max;
        });
      const list = candidates.length ? candidates : features.map(feature => feature && feature.attributes).filter(Boolean);
      list.sort((a, b) => {
        const da = Number(a.DrawOrder || 0);
        const db = Number(b.DrawOrder || 0);
        if (db !== da) return db - da;
        const ra = Number(a.SRC_RES || Number.POSITIVE_INFINITY);
        const rb = Number(b.SRC_RES || Number.POSITIVE_INFINITY);
        return ra - rb;
      });
      return list[0] || null;
    }

    async function queryEsriMetadata(lat, lon, zoom, strictZoom) {
      const params = new URLSearchParams({
        f: 'json',
        returnGeometry: 'false',
        geometryType: 'esriGeometryPoint',
        geometry: lon.toFixed(6) + ',' + lat.toFixed(6),
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'SRC_DATE,SRC_DATE2,SRC_RES,SRC_ACC,SRC_DESC,NICE_NAME,NICE_DESC,MinMapLevel,MaxMapLevel,DrawOrder,BlockName,ReleaseName',
        resultRecordCount: '8',
      });
      if (strictZoom) {
        params.set('where', 'MinMapLevel <= ' + zoom + ' AND MaxMapLevel >= ' + zoom);
        params.set('orderByFields', 'DrawOrder DESC');
      } else {
        params.set('where', '1=1');
      }
      const url = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/0/query?' + params.toString();
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) throw new Error('Esri metadata request failed');
      const json = await response.json();
      if (json && json.error) throw new Error(json.error.message || 'Esri metadata error');
      return chooseBestFeature(json && json.features, zoom);
    }

    async function handleMetadataLookup(position, options) {
      const pointer = options && options.pointer ? options.pointer : { x: position.x, y: position.y };
      const picked = pickCartographic(position);
      if (!picked) return;
      const zoom = getApproxZoom();
      const token = ++queryToken;
      showStatus('위성 사진 정보 조회 중...', pointer);
      try {
        let metadata = null;
        try {
          metadata = await queryEsriMetadata(picked.lat, picked.lon, zoom, true);
        } catch (strictError) {
          console.warn('Esri strict metadata lookup failed; retrying without zoom filter:', strictError);
        }
        if (!metadata) metadata = await queryEsriMetadata(picked.lat, picked.lon, zoom, false);
        if (token !== queryToken) return;
        if (!metadata) {
          showStatus('이 좌표에서 표시할 수 있는 Esri 메타데이터를 찾지 못했습니다. 조금 더 확대하거나 주변을 다시 시도해 주세요.', pointer);
          return;
        }
        showStatus('위치 정보 확인 중...', pointer);
        const locationInfo = await resolveLocationInfo(picked.lat, picked.lon);
        if (token !== queryToken) return;
        showMetadata(metadata, picked.lat, picked.lon, zoom, pointer, locationInfo);
      } catch (error) {
        if (token !== queryToken) return;
        console.warn('Esri imagery metadata lookup failed:', error);
        showStatus('메타데이터 조회에 실패했습니다. 네트워크 또는 Esri 응답을 확인해 주세요.', pointer);
      }
    }

    function getCenterScreenPosition() {
      const canvas = scene && scene.canvas;
      if (!canvas) return null;
      return new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    }

    function handleCenterLookup() {
      const position = getCenterScreenPosition();
      if (!position) return;
      handleMetadataLookup(position, { pointer: { x: window.innerWidth / 2, y: window.innerHeight / 2 } });
    }

    function syncMobileMetaButtonPosition() {
      if (!mobileBtn) return;
      if (!isMobileViewport()) {
        mobileBtn.style.left = '';
        mobileBtn.style.right = '';
        mobileBtn.style.bottom = '';
        return;
      }
      // 지구 아이콘이 우측 하단 10px에 있으므로, 위성 정보 아이콘은 좌측 하단 10px에 고정해 대칭을 맞춘다.
      mobileBtn.style.left = 'calc(10px + env(safe-area-inset-left))';
      mobileBtn.style.right = 'auto';
      mobileBtn.style.bottom = 'calc(12px + env(safe-area-inset-bottom))';
    }

    if (mobileBtn) {
      requestAnimationFrame(syncMobileMetaButtonPosition);
      window.addEventListener('resize', syncMobileMetaButtonPosition, { passive: true });
      window.addEventListener('orientationchange', () => setTimeout(syncMobileMetaButtonPosition, 160), { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncMobileMetaButtonPosition, { passive: true });
        window.visualViewport.addEventListener('scroll', syncMobileMetaButtonPosition, { passive: true });
      }
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMetadataCard();
      });
    }
    card.addEventListener('click', event => event.stopPropagation());
    if (mobileBtn) {
      mobileBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (card.classList.contains('show')) {
          closeMetadataCard();
          return;
        }
        // 모바일에서 다른 패널이 열린 상태로 위성 정보 버튼을 누르면
        // 기존 패널을 먼저 닫고 위성 정보 창만 열리게 한다.
        if (typeof closeOtherPanels === 'function') {
          closeOtherPanels(null);
        }
        handleCenterLookup();
      });
    }
    handler.setInputAction((movement) => {
      if (isMobileViewport()) return;
      const position = movement.position || movement.endPosition;
      if (position) handleMetadataLookup(position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function wireInfoBar(viewer, sharedState) {
    const scene = viewer.scene;
    const ibLat = document.getElementById('ib-lat');
    const ibLon = document.getElementById('ib-lon');
    const ibAlt = document.getElementById('ib-alt');
    const ibZoom = document.getElementById('ib-zoom');
    const ziFill = document.getElementById('zi-fill');
    const ziVal = document.getElementById('zi-val');
    const miBox = document.getElementById('mouse-info');
    const miPlace = document.getElementById('mi-place');
    const miKind = document.getElementById('mi-kind');
    const miDetail = document.getElementById('mi-detail');
    const MAX_Z = 19;
    // 핫패스에서 matchMedia 반복 호출 방지: 1회 평가
    const _isMobile = window.matchMedia('(max-width: 768px)').matches;
    const _postRenderThrottleMs = _isMobile ? 100 : 50;
    const _reverseDebounceMs = _isMobile ? 250 : 120;

    function altToZoom(height) {
      const z = Math.round(19 - Math.log2(Math.max(1, height) / 300));
      return Math.max(0, Math.min(MAX_Z, z));
    }

    function zoomToAlt(zoom) {
      const safeZoom = Math.max(0, Math.min(MAX_Z, Number(zoom) || 0));
      return 300 * Math.pow(2, 19 - safeZoom);
    }

    function formatAltitude(height) {
      if (height >= 1e6) return (height / 1e6).toFixed(2) + ' Mm';
      if (height >= 1e3) return (height / 1e3).toFixed(1) + ' km';
      return height.toFixed(0) + ' m';
    }

    function applyZoomLevel(targetZoom) {
      const controller = scene.screenSpaceCameraController;
      const current = viewer.camera.positionCartographic;
      if (!current) return;

      const safeZoom = Math.max(0, Math.min(MAX_Z, Math.round(Number(targetZoom) || 0)));
      const minHeight = controller.minimumZoomDistance || 0;
      const maxHeight = controller.maximumZoomDistance || Number.POSITIVE_INFINITY;
      const targetHeight = Math.max(minHeight, Math.min(maxHeight, zoomToAlt(safeZoom)));
      const safeLat = clampLatitudeRadians(current.latitude);

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(current.longitude, safeLat, targetHeight),
        orientation: {
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
        },
      });

      const appliedZoom = altToZoom(targetHeight);
      const zoomText = 'Z' + appliedZoom;
      ziVal.textContent = zoomText;
      ziFill.style.height = Math.round((appliedZoom / MAX_Z) * 100) + '%';
      ibAlt.textContent = formatAltitude(targetHeight);
      if (ibZoom) ibZoom.textContent = zoomText;
      scene.requestRender();
    }

    function stepZoom(delta) {
      const current = viewer.camera.positionCartographic;
      const currentZoom = current ? altToZoom(current.height) : 0;
      applyZoomLevel(currentZoom + delta);
    }

    function wireZoomGaugeControl() {
      const zoomIndicator = document.getElementById('zoom-ind');
      const zoomInBtn = document.getElementById('zoom-in-btn');
      const zoomOutBtn = document.getElementById('zoom-out-btn');
      const zoomTrack = document.querySelector('#zoom-ind .zi-track');
      if (!zoomIndicator) return;

      // 게이지바 직접 클릭/드래그 줌은 위치 계산 오동작 여지가 있어 비활성화.
      // 위/아래 화살표 버튼으로 PC/모바일 모두 1단계씩 안정적으로 줌 변경.
      const stopOnly = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (zoomTrack) {
        zoomTrack.addEventListener('pointerdown', stopOnly, { passive: false });
        zoomTrack.addEventListener('click', stopOnly, { passive: false });
      }

      const bindStepButton = (button, delta) => {
        if (!button) return;
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          event.stopPropagation();
        }, { passive: false });
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          stepZoom(delta);
        }, { passive: false });
      };

      bindStepButton(zoomInBtn, 1);
      bindStepButton(zoomOutBtn, -1);
    }

    wireZoomGaugeControl();

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    let reverseLookupToken = 0;
    let reverseDebounce = null;
    let latestLocationKey = '';

    function pickCartesian(screenPosition) {
      if (!screenPosition) return null;
      const ray = viewer.camera.getPickRay(screenPosition);
      return (ray && scene.globe.pick(ray, scene)) || viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid);
    }

    function positionMouseInfo(pointer) {
      if (_isMobile) return;
      miBox.style.display = 'block';
      miBox.style.left = Math.max(10, pointer.x - miBox.offsetWidth - 18) + 'px';
      miBox.style.top = Math.max(10, pointer.y - Math.min(20, miBox.offsetHeight / 2)) + 'px';
    }

    function setMouseInfo(primary, kind, detail, pointer) {
      let label = primary || '-';
      if (kind === '지하철역' && detail && detail.startsWith('노선: ') && detail !== '노선: ') {
        label = primary + ' (' + detail.replace('노선: ', '') + ')';
      } else if (kind === '지하철 노선') {
        label = primary + ' 노선';
      }
      // 일반 지도: label이 이미 정교하게 구성되어 있으므로 그대로 표시
      if (miPlace) miPlace.textContent = label;
      if (pointer) positionMouseInfo(pointer);
    }

    function extractPickedInfo(screenPosition) {
      if (!screenPosition) return null;
      let picked = null;
      try {
        picked = scene.pick(screenPosition);
      } catch (error) {
        picked = null;
      }
      const entity = picked && (picked.id || (picked.primitive && picked.primitive.id));
      if (!entity || !entity.properties) return null;
      const kind = Cesium.defined(entity.properties.kind) && typeof entity.properties.kind.getValue === 'function'
        ? entity.properties.kind.getValue(Cesium.JulianDate.now())
        : entity.properties.kind;
      const name = Cesium.defined(entity.properties.name) && typeof entity.properties.name.getValue === 'function'
        ? entity.properties.name.getValue(Cesium.JulianDate.now())
        : entity.properties.name;
      const line = Cesium.defined(entity.properties.line) && typeof entity.properties.line.getValue === 'function'
        ? entity.properties.line.getValue(Cesium.JulianDate.now())
        : entity.properties.line;

      if (kind === 'subway-station') {
        return {
          primary: name || '지하철역',
          kind: '지하철역',
          detail: line ? ('노선: ' + line) : '노선 정보 없음',
          exact: true,
        };
      }
      if (kind === 'subway-line') {
        return {
          primary: name || '지하철 노선',
          kind: '지하철 노선',
          detail: '노선 경로',
          exact: true,
        };
      }
      return null;
    }

    function scheduleReverseLookup(lat, lon, pointer) {
      const key = lat.toFixed(3) + ',' + lon.toFixed(3);
      if (latestLocationKey === key) {
        positionMouseInfo(pointer);
        return;
      }
      latestLocationKey = key;
      setMouseInfo('위치 확인 중...', '일반 지도', '', pointer);
      clearTimeout(reverseDebounce);
      const token = ++reverseLookupToken;
      const debounceMs = _reverseDebounceMs;
      reverseDebounce = setTimeout(async () => {
        try {
          const result = await window.WorldSearch.reverseGeocode(lat, lon);
          if (token !== reverseLookupToken || latestLocationKey !== key) return;
          const primary = result.label || (lat.toFixed(4) + ', ' + lon.toFixed(4));
          setMouseInfo(primary, '일반 지도', '', pointer);
        } catch (error) {
          if (token !== reverseLookupToken || latestLocationKey !== key) return;
          setMouseInfo(lat.toFixed(4) + ', ' + lon.toFixed(4), '일반 지도', '', pointer);
        }
      }, 120);
    }

    function updateLatLonInfoFromCartesian(cartesian) {
      if (!cartesian) return null;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return null;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      ibLat.textContent = (lat >= 0 ? 'N ' : 'S ') + Math.abs(lat).toFixed(4) + '°';
      ibLon.textContent = (lon >= 0 ? 'E ' : 'W ') + Math.abs(lon).toFixed(4) + '°';
      return { lat, lon };
    }

    function getCenterCartesian() {
      const canvas = scene && scene.canvas;
      if (!canvas) return null;
      return pickCartesian(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    }

    function updateFromCartesian(cartesian, pointer, screenPosition) {
      const cameraPosition = viewer.camera.positionCartographic;
      if (!cameraPosition) return;
      const zoom = altToZoom(cameraPosition.height);
      ziVal.textContent = 'Z' + zoom;
      ziFill.style.height = Math.round((zoom / MAX_Z) * 100) + '%';
      ibAlt.textContent = formatAltitude(cameraPosition.height);
      if (ibZoom) ibZoom.textContent = 'Z' + zoom;
      if (!cartesian || !pointer) return;

      const pickedLatLon = updateLatLonInfoFromCartesian(cartesian);
      if (!pickedLatLon) return;
      const lat = pickedLatLon.lat;
      const lon = pickedLatLon.lon;

      const pickedInfo = extractPickedInfo(screenPosition || pointer);
      if (pickedInfo && pickedInfo.exact) {
        latestLocationKey = 'entity:' + [pickedInfo.kind, pickedInfo.primary, pickedInfo.detail].join('|');
        reverseLookupToken += 1;
        clearTimeout(reverseDebounce);
        setMouseInfo(pickedInfo.primary, pickedInfo.kind, pickedInfo.detail, pointer);
        return;
      }

      positionMouseInfo(pointer);
      scheduleReverseLookup(lat, lon, pointer);
    }

    handler.setInputAction(movement => {
      sharedState.lastPointerPosition = { x: movement.endPosition.x, y: movement.endPosition.y };
      sharedState.lastPointerCartesian = pickCartesian(movement.endPosition);
      updateFromCartesian(sharedState.lastPointerCartesian, sharedState.lastPointerPosition, movement.endPosition);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(movement => {
      const position = movement.position || movement.endPosition;
      sharedState.lastPointerPosition = { x: position.x, y: position.y };
      sharedState.lastPointerCartesian = pickCartesian(position);
      updateFromCartesian(sharedState.lastPointerCartesian, sharedState.lastPointerPosition, position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    scene.canvas.addEventListener('mouseleave', () => {
      sharedState.lastPointerCartesian = null;
      sharedState.lastPointerPosition = null;
      latestLocationKey = '';
      reverseLookupToken += 1;
      miBox.style.display = 'none';
    });

    let _lastPostRenderMs = 0;
    scene.postRender.addEventListener(() => {
      clampCameraDistance(viewer);
      const cameraPosition = viewer.camera.positionCartographic;
      if (!cameraPosition) return;
      const zoom = altToZoom(cameraPosition.height);
      // 줌/고도 표시: 가볍고 중요하므로 항상 업데이트
      const zoomText = 'Z' + zoom;
      if (ziVal.textContent !== zoomText) ziVal.textContent = zoomText;
      const fillPct = Math.round((zoom / MAX_Z) * 100) + '%';
      if (ziFill.style.height !== fillPct) ziFill.style.height = fillPct;
      const altText = formatAltitude(cameraPosition.height);
      if (ibAlt.textContent !== altText) ibAlt.textContent = altText;
      if (ibZoom && ibZoom.textContent !== zoomText) ibZoom.textContent = zoomText;
      // 모바일은 손가락 탭 위치가 아니라 화면 중앙 십자선 기준 좌표를 정보바와 위성정보가 함께 사용한다.
      // 이 처리가 없으면 PC/모바일에서 같은 위치로 이동해도 정보바/위성정보 위치가 서로 다르게 보일 수 있다.
      if (_isMobile) {
        const centerCartesian = getCenterCartesian();
        if (centerCartesian) updateLatLonInfoFromCartesian(centerCartesian);
        return;
      }

      // 포인터 위치 업데이트: throttle (데스크탑 50ms)
      const now = performance.now();
      if (now - _lastPostRenderMs < _postRenderThrottleMs) return;
      _lastPostRenderMs = now;
      if (sharedState.lastPointerCartesian && sharedState.lastPointerPosition) {
        updateFromCartesian(sharedState.lastPointerCartesian, sharedState.lastPointerPosition, sharedState.lastPointerPosition);
      }
    });
  }

  function clampLatitudeRadians(latitude) {
    const maxLat = Cesium.Math.toRadians(MAX_VIEW_LATITUDE);
    return Cesium.Math.clamp(latitude, -maxLat, maxLat);
  }

  function clampCameraDistance(viewer) {
    const controller = viewer.scene.screenSpaceCameraController;
    const position = viewer.camera.positionCartographic;
    if (!position) return;

    const minHeight = controller.minimumZoomDistance || 0;
    const maxHeight = controller.maximumZoomDistance || Number.POSITIVE_INFINITY;
    const clampedHeight = Math.max(minHeight, Math.min(maxHeight, position.height));
    const clampedLatitude = clampLatitudeRadians(position.latitude);
    if (Math.abs(clampedHeight - position.height) < 1 && Math.abs(clampedLatitude - position.latitude) < Cesium.Math.toRadians(0.001)) return;

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(position.longitude, clampedLatitude, clampedHeight),
      orientation: {
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll,
      },
    });
  }

  function wireHomeButton(viewer, sharedState, styleManager) {
    const restoreHomeSatellite = () => {
      sharedState.lastSearchResult = null;
      sharedState.currentStyle = DEFAULT_STYLE;
      if (styleManager && typeof styleManager.finishHomeReturn === 'function') {
        styleManager.finishHomeReturn();
      } else if (styleManager && typeof styleManager.setStyle === 'function') {
        styleManager.setStyle(DEFAULT_STYLE);
      }
      document.querySelectorAll('#style-panel [data-style]').forEach(item => {
        item.classList.toggle('active', item.dataset.style === DEFAULT_STYLE);
      });
      viewer.scene.requestRender();
    };

    document.getElementById('globe-home-btn').addEventListener('click', () => {
      sharedState.lastSearchResult = null;
      sharedState.currentStyle = DEFAULT_STYLE;
      if (styleManager && typeof styleManager.prepareHomeReturn === 'function') {
        styleManager.prepareHomeReturn();
      } else if (styleManager && typeof styleManager.setStyle === 'function') {
        styleManager.setStyle(DEFAULT_STYLE);
      }
      document.querySelectorAll('#style-panel [data-style]').forEach(item => {
        item.classList.toggle('active', item.dataset.style === DEFAULT_STYLE);
      });
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
        orientation: {
          heading: Cesium.Math.toRadians(HOME_VIEW.heading),
          pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
          roll: HOME_VIEW.roll,
        },
        duration: 1.8,
        complete: restoreHomeSatellite,
        cancel: restoreHomeSatellite,
      });
      window.setTimeout(restoreHomeSatellite, 2100);
    });
  }

  function wireSearch(viewer, sharedState) {
    const row = document.getElementById('search-row');
    const panel = document.getElementById('srch-panel');
    const btn = document.getElementById('srch-btn');
    const input = document.getElementById('srch-input');
    const clearBtn = document.getElementById('srch-clear');
    const results = document.getElementById('srch-results');
    const countLabel = document.getElementById('srch-count');
    const wrap = document.getElementById('search-wrap');

    let isOpen = false;
    let currentItems = [];
    let activeIndex = -1;
    let debounce = null;
    let queryToken = 0;

    function syncResultsWidth() {
      const width = Math.max(row.getBoundingClientRect().width, 280);
      results.style.width = width + 'px';
    }

    function syncCollapsedState() {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      wrap.classList.toggle('is-collapsed', isMobile && !isOpen);
    }

    function openPanel() {
      isOpen = true;
      row.classList.add('is-open');
      panel.classList.add('is-open');
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      syncCollapsedState();
      requestAnimationFrame(syncResultsWidth);
      setTimeout(() => input.focus(), 50);
    }

    function closePanel() {
      isOpen = false;
      row.classList.remove('is-open', 'has-results');
      panel.classList.remove('is-open');
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      results.style.display = 'none';
      activeIndex = -1;
      currentItems = [];
      syncCollapsedState();
    }

    function renderResults(items) {
      currentItems = items;
      activeIndex = -1;
      if (!items.length) {
        syncResultsWidth();
        results.innerHTML = '<div class="r-msg">검색 결과가 없습니다.</div>';
        results.style.display = 'block';
        row.classList.add('has-results');
        countLabel.textContent = '0건';
        return;
      }

      syncResultsWidth();
      results.innerHTML = '';
      items.forEach((item, index) => {
        const meta = window.WorldSearch.getResultLabel(item);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'r-item';
        const icon = item.type === 'station' ? '🚉' : item.type === 'country' ? '🌐' : item.isCapital ? '🏛️' : '🏙️';
        const kind = item.type === 'station' ? '지하철역' : item.type === 'country' ? '나라' : item.isCapital ? '수도' : '도시';
        button.innerHTML = `
          <span class="r-ico">${icon}</span>
          <span class="r-txt">
            <span class="r-name">${escapeHtml(meta.primary)}</span>
            <span class="r-sub">${escapeHtml(meta.secondary)}</span>
          </span>
          <span class="r-kind">${kind}</span>
        `;
        button.addEventListener('click', () => flyToResult(item));
        button.addEventListener('mouseenter', () => setActive(index));
        results.appendChild(button);
      });
      results.style.display = 'block';
      row.classList.add('has-results');
      countLabel.textContent = items.length + '건';
    }

    function setActive(index) {
      const elements = results.querySelectorAll('.r-item');
      if (!elements.length) return;
      activeIndex = Math.max(0, Math.min(elements.length - 1, index));
      elements.forEach((element, itemIndex) => element.classList.toggle('act', itemIndex === activeIndex));
      elements[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    async function searchLocal(query) {
      const token = ++queryToken;
      countLabel.textContent = '검색중';
      const list = await window.WorldSearch.searchPlaces(query, { maxResults: 12 });
      if (token !== queryToken) return;
      renderResults(list);
    }

    function flyToResult(item) {
      const fly = window.WorldSearch.getFlyToOptions(item);
      const safeLat = Cesium.Math.clamp(item.lat, -MAX_VIEW_LATITUDE, MAX_VIEW_LATITUDE);
      const isKrLocalArea = item.type !== 'country' && String(item.countryCode || '').toUpperCase() === 'KR' && /(동|읍|면|리)$/u.test(String(item.nameKo || item.nameEn || item.name || '').trim());
      const spanByZoom = { 5: 18, 6: 12, 7: 8, 8: 4.8, 9: 2.4, 10: 1.2, 11: 0.45, 12: 0.18, 13: 0.08, 14: 0.04, 15: 0.02, 16: 0.012 };
      // 국가는 zoom 6, 일반 위치는 14, 한국 동/읍/면/리는 더 가깝게 진입
      const defaultZoom = item.type === 'country' ? 6 : (isKrLocalArea ? 16 : 14);
      const zoomKey = Math.max(5, Math.min(16, Number(item.type === 'country' ? (item.zoom || defaultZoom) : defaultZoom)));
      const latSpan = spanByZoom[zoomKey] ?? 0.04;
      const lonSpan = latSpan / Math.max(0.35, Math.cos(Cesium.Math.toRadians(safeLat)));
      const finalAltitude = isKrLocalArea ? 650 : (item.type === 'station' ? 1500 : fly.altitude);
      const rectangle = Cesium.Rectangle.fromDegrees(
        item.lon - lonSpan / 2,
        Cesium.Math.clamp(safeLat - latSpan / 2, -MAX_VIEW_LATITUDE, MAX_VIEW_LATITUDE),
        item.lon + lonSpan / 2,
        Cesium.Math.clamp(safeLat + latSpan / 2, -MAX_VIEW_LATITUDE, MAX_VIEW_LATITUDE)
      );
      viewer.camera.flyTo({
        destination: rectangle,
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.8,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: () => {
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(item.lon, safeLat, finalAltitude),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          });
        },
      });
      sharedState.lastSearchResult = item;
      const label = item.type === 'country'
        ? (item.nameKo || item.nameEn)
        : item.type === 'station'
          ? (item.nameKo || item.nameEn || item.name) + (((item.line || '') || (item.countryKo || item.countryEn)) ? ' · ' + ([item.line, item.countryKo || item.countryEn].filter(Boolean).join(' · ')) : '')
          : (item.nameKo || item.nameEn) + ((item.countryKo || item.countryEn) ? ' · ' + (item.countryKo || item.countryEn) : '');
      input.value = label;
      clearBtn.style.display = 'inline-flex';
      results.style.display = 'none';
      row.classList.remove('has-results');
      setTimeout(() => input.focus(), 20);
    }

    btn.addEventListener('click', () => { isOpen ? closePanel() : openPanel(); });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      results.style.display = 'none';
      row.classList.remove('has-results');
      input.focus();
      countLabel.textContent = '0건';
      queryToken += 1;
    });

    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const query = input.value.trim();
      clearBtn.style.display = query ? 'inline-flex' : 'none';
      if (!query) {
        results.style.display = 'none';
        row.classList.remove('has-results');
        countLabel.textContent = '0건';
        queryToken += 1;
        return;
      }
      debounce = setTimeout(() => searchLocal(query), 120);
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
      if (!currentItems.length) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
      if (event.key === 'Enter') {
        event.preventDefault();
        const item = currentItems[activeIndex >= 0 ? activeIndex : 0];
        if (item) flyToResult(item);
      }
    });

    document.addEventListener('keydown', event => {
      if (document.activeElement === input) return;
      if (event.key === '/' || (event.ctrlKey && event.key.toLowerCase() === 'f')) {
        event.preventDefault();
        if (!isOpen) openPanel(); else input.focus();
      }
      if (event.key.toLowerCase() === 'h') {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(HOME_VIEW.pitch), roll: 0 },
          duration: 1.8,
        });
      }
    });

    document.addEventListener('click', event => {
      if (!wrap.contains(event.target) && isOpen) {
        results.style.display = 'none';
        row.classList.remove('has-results');
      }
    });
    window.addEventListener('resize', () => {
      syncCollapsedState();
      syncResultsWidth();
    });
    syncCollapsedState();
    syncResultsWidth();
  }

  function wireShare(viewer, sharedState, styleManager) {
    const toast = document.getElementById('toast');
    const copyBtn = document.getElementById('copy-link-btn');
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    function getCameraView() {
      const carto = viewer.camera.positionCartographic;
      return {
        lon: Cesium.Math.toDegrees(carto.longitude),
        lat: Cesium.Math.toDegrees(carto.latitude),
        alt: carto.height,
        heading: Cesium.Math.toDegrees(viewer.camera.heading),
        pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
        style: sharedState.currentStyle || DEFAULT_STYLE,
      };
    }

    function makeShareUrl() {
      const v = getCameraView();
      const hash = [
        'lon=' + v.lon.toFixed(6),
        'lat=' + v.lat.toFixed(6),
        'alt=' + Math.round(v.alt),
        'heading=' + v.heading.toFixed(2),
        'pitch=' + v.pitch.toFixed(2),
        'style=' + encodeURIComponent(v.style),
      ].join('&');
      return location.origin + location.pathname + '#' + hash;
    }

    function syncHash() {
      const url = makeShareUrl();
      history.replaceState(null, '', url);
    }

    async function copyShareUrl() {
      const url = makeShareUrl();
      try {
        await navigator.clipboard.writeText(url);
        showToast('링크가 복사되었습니다.');
      } catch (error) {
        prompt('링크를 복사하세요', url);
      }
    }

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(sharedState.shareToastTimer);
      sharedState.shareToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    copyBtn.addEventListener('click', copyShareUrl);
    viewer.scene.canvas.addEventListener('contextmenu', event => event.preventDefault());
    handler.setInputAction(copyShareUrl, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    // 모바일 주소창/히스토리 갱신이 브라우저 리사이즈와 겹치면 간헐 새로고침처럼 보일 수 있다.
    // PC는 기존처럼 URL hash 동기화를 유지한다.
    if (!isMobile) {
      viewer.camera.moveEnd.addEventListener(syncHash);
      syncHash();
    }
  }



  function closeOtherPanels(exceptId) {
    // PC 지도 클릭으로 위성 사진 정보 창이 열릴 때 같은 클릭 이벤트가 document까지
    // 버블링되며 즉시 닫히지 않도록, 다른 도구 패널을 여는 경우에만 닫는다.
    if (exceptId && typeof window.closeImageryMetadataCard === 'function') {
      window.closeImageryMetadataCard();
    }
    document.querySelectorAll('.tool-panel.open').forEach((panel) => {
      if (!exceptId || panel.id !== exceptId) panel.classList.remove('open');
    });
  }

  function wirePanelExclusivity() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      const inPanel = target.closest('.tool-panel');
      const isToggle = target.closest('#style-toggle-btn');
      if (!inPanel && !isToggle) closeOtherPanels(null);
    });
  }

  function readViewFromHash() {
    if (!location.hash) return null;
    const hash = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash.replace(/&/g, '&'));
    const lon = Number(params.get('lon'));
    const lat = Number(params.get('lat'));
    const alt = Number(params.get('alt'));
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) return null;
    return {
      lon,
      lat,
      alt,
      heading: Number(params.get('heading') || 0),
      pitch: Number(params.get('pitch') || -90),
      style: params.get('style') || DEFAULT_STYLE,
    };
  }


  function positionPanelNearButton(panel, button, options = {}) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      // 모바일: 하단 고정 시트 (CSS가 처리)
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '';
      panel.style.bottom = '';
      return;
    }
    const gap = options.gap || 12;
    const offsetY = options.offsetY || 0;
    const buttonRect = button.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const top = Math.min(
      Math.max(10, buttonRect.top + buttonRect.height / 2 - panelRect.height / 2 + offsetY),
      viewportHeight - panelRect.height - 10,
    );
    const left = Math.max(10, Math.min(viewportWidth - panelRect.width - 10, buttonRect.left - panelRect.width - gap));
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function wireCurrentLocation(viewer) {
    const btn = document.getElementById('my-location-btn');

    function doFlyTo(latitude, longitude) {
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      const safetyTimer = setTimeout(() => {
        window._locationFlyActive = false;
        btn.disabled = false;
      }, 15000);

      if (isMobile) {
        window._locationFlyActive = true;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 7000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.4,
          complete: () => { window._locationFlyActive = false; clearTimeout(safetyTimer); btn.disabled = false; },
          cancel: () => { window._locationFlyActive = false; clearTimeout(safetyTimer); btn.disabled = false; },
        });
      } else {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 7000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.6,
          complete: () => { clearTimeout(safetyTimer); btn.disabled = false; },
          cancel: () => { clearTimeout(safetyTimer); btn.disabled = false; },
        });
      }
    }

    btn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('이 브라우저는 현재 위치 기능을 지원하지 않습니다.');
        return;
      }
      btn.disabled = true;

      // watchPosition으로 첫 번째 정확한 위치를 받은 후 즉시 중단
      // maximumAge: 0 → 캐시 사용 안 함, 항상 새 위치 요청
      let watchId = null;
      let settled = false;
      const giveUpTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (watchId !== null) navigator.geolocation.clearWatch(watchId);
          btn.disabled = false;
          alert('현재 위치를 가져오지 못했습니다. 위치 권한을 확인해 주세요.');
        }
      }, 20000);

      watchId = navigator.geolocation.watchPosition(position => {
        const { latitude, longitude, accuracy } = position.coords;
        // 정확도 300m 이하일 때 확정 (GPS 정착 전 큰 오차 무시)
        if (accuracy > 300 && !settled) return;
        if (settled) return;
        settled = true;
        clearTimeout(giveUpTimer);
        navigator.geolocation.clearWatch(watchId);
        doFlyTo(latitude, longitude);
      }, error => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUpTimer);
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        btn.disabled = false;
        alert('현재 위치를 가져오지 못했습니다. 위치 권한을 확인해 주세요.');
        console.warn(error);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    });
  }

  function wireStylePicker(viewer, styleManager, sharedState) {
    const panel = document.getElementById('style-panel');
    const btn = document.getElementById('style-toggle-btn');
    const buttons = Array.from(panel.querySelectorAll('[data-style]'));

    function apply(style) {
      sharedState.currentStyle = styleManager.setStyle(style);
      buttons.forEach(item => item.classList.toggle('active', item.dataset.style === sharedState.currentStyle));
    }

    function togglePanel() {
      const willOpen = !panel.classList.contains('open');
      closeOtherPanels(willOpen ? panel.id : null);
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        requestAnimationFrame(() => positionPanelNearButton(panel, btn, { offsetY: 16 }));
      }
    }

    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePanel();
    });
    panel.addEventListener('click', (event) => event.stopPropagation());
    window.addEventListener('resize', () => {
      if (panel.classList.contains('open')) positionPanelNearButton(panel, btn, { offsetY: 16 });
    });
    buttons.forEach(item => item.addEventListener('click', () => {
      apply(item.dataset.style);
      // 선택 후 패널 자동 닫힘
      setTimeout(() => {
        panel.classList.remove('open');
      }, 150);
    }));
    apply(sharedState.currentStyle || DEFAULT_STYLE);
  }

  function wireMiniMap(viewer) {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const bg = new Image();
    bg.src = 'earth-loading.png';

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(64, Math.round(rect.width * dpr));
      const height = Math.max(64, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function draw() {
      resizeCanvas();
      const size = Math.min(canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radius = size / 2 - 8;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (bg.complete) {
        ctx.drawImage(bg, cx - radius, cy - radius, radius * 2, radius * 2);
      } else {
        ctx.fillStyle = '#09172f';
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = Math.max(2, canvas.width / 60);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      const carto = viewer.camera.positionCartographic;
      if (!carto) return;
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const x = cx - radius + ((lon + 180) / 360) * (radius * 2);
      const y = cy - radius + ((90 - lat) / 180) * (radius * 2);

      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = Math.max(2, canvas.width / 70);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5, canvas.width / 24), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, canvas.width / 36), 0, Math.PI * 2);
      ctx.fill();
    }

    bg.onload = draw;
    let _minimapThrottle = null;
    const throttledDraw = () => {
      if (_minimapThrottle) return;
      _minimapThrottle = requestAnimationFrame(() => {
        _minimapThrottle = null;
        draw();
      });
    };
    // 모바일: minimap이 display:none이므로 camera.changed 리스너 불필요
    if (!window.matchMedia('(max-width: 768px)').matches) {
      viewer.camera.changed.addEventListener(throttledDraw);
    }
    window.addEventListener('resize', draw);
    draw();
  }
  function wireMobileGestures(viewer) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;
    const controller = viewer.scene.screenSpaceCameraController;
    const canvas = viewer.scene.canvas;
    controller.bounceAnimationTime = 0;
    controller.inertiaSpin = 0.08;
    controller.inertiaTranslate = 0.12;
    controller.inertiaZoom = 0.10;
    controller.enableTilt = false;
    controller.enableLook = false;
    controller.enableRotate = true;
    controller.tiltEventTypes = [];
    controller.lookEventTypes = [];
    controller.zoomFactor = 9.0;
    canvas.style.touchAction = 'none';

    // 모바일도 PC처럼 정북향 + 탑다운 각도 고정
    let lockCameraSync = false;
    let syncQueued = false;
    const syncTopDownCamera = () => {
      // 내 위치 flyTo 진행 중에는 카메라 강제 보정하지 않음 (complete 미발동 버그 방지)
      if (window._locationFlyActive) return;
      if (lockCameraSync) return;
      const position = viewer.camera.positionCartographic;
      if (!position) return;
      const heading = Cesium.Math.negativePiToPi(viewer.camera.heading || 0);
      const pitch = viewer.camera.pitch || Cesium.Math.toRadians(-90);
      const headingDiff = Math.abs(heading);
      const pitchDiff = Math.abs(pitch - Cesium.Math.toRadians(-90));
      if (headingDiff < Cesium.Math.toRadians(0.05) && pitchDiff < Cesium.Math.toRadians(0.05)) return;
      lockCameraSync = true;
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, position.height),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
      });
      lockCameraSync = false;
    };
    const queueTopDownSync = () => {
      if (syncQueued) return;
      syncQueued = true;
      requestAnimationFrame(() => {
        syncQueued = false;
        syncTopDownCamera();
      });
    };
    // requestRenderMode 상태에서 모바일 드래그 중 라벨/아이콘이 한 프레임 늦게 고정되는 것을 방지한다.
    let renderQueued = false;
    const queueCameraRender = () => {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        viewer.scene.requestRender();
      });
    };

    viewer.camera.changed.addEventListener(queueTopDownSync);
    viewer.camera.changed.addEventListener(queueCameraRender);
    viewer.camera.moveStart.addEventListener(queueCameraRender);
    viewer.camera.moveEnd.addEventListener(() => {
      syncTopDownCamera();
      queueCameraRender();
      setTimeout(queueCameraRender, 80);
    });
    syncTopDownCamera();

    // 모바일 브라우저 pull-to-refresh / 확대 제스처로 UI가 사라지는 현상 방지
    let touchCount = 0;
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    canvas.style.webkitTapHighlightColor = 'transparent';
    canvas.style.userSelect = 'none';
    canvas.style.webkitUserSelect = 'none';

    const updateTouchCount = (event) => { touchCount = event.touches ? event.touches.length : 0; };
    window.addEventListener('touchstart', updateTouchCount, { passive: true });
    window.addEventListener('touchend', updateTouchCount, { passive: true });
    window.addEventListener('touchcancel', () => { touchCount = 0; }, { passive: true });
    window.addEventListener('touchmove', (event) => {
      if (touchCount >= 2 || window.scrollY <= 0) event.preventDefault();
    }, { passive: false });
    window.addEventListener('pageshow', () => {
      queueTopDownSync();
      viewer.resize();
      viewer.scene.requestRender();
    });

    document.body.classList.toggle('is-touch', true);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
