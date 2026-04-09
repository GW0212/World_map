(function () {
  'use strict';

  const MAX_VIEW_LATITUDE = 84.8;
  const FAVORITES_KEY = 'worldmap:favorites:v1';
  const DEFAULT_STYLE = 'satellite';
  const HOME_VIEW = {
    lon: 127.5,
    lat: 36.0,
    alt: 18000000,
    heading: 0,
    pitch: -90,
    roll: 0,
  };

  window.CESIUM_BASE_URL = 'https://cdn.jsdelivr.net/npm/cesium@1.95.0/Build/Cesium/';

  function boot() {
    Cesium.Ion.defaultAccessToken = undefined;

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

    const isMobileInit = window.matchMedia('(max-width: 768px)').matches;
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
    wireHomeButton(viewer, sharedState);
    wireSearch(viewer, sharedState);
    wireShare(viewer, sharedState, styleManager);
    wireCurrentLocation(viewer, sharedState);
    wirePanelExclusivity();
    wireStylePicker(viewer, styleManager, sharedState);
    wireMiniMap(viewer);
    wireFavorites(viewer, sharedState);
    wireMobileGestures(viewer);

    scene.requestRender();
  }

  function createViewer(creditSink) {
    try {
      return new Cesium.Viewer('cesiumContainer', {
        imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
          enablePickFeatures: false,
        }),
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
      });
    } catch (error) {
      console.warn('ArcGIS provider fallback:', error);
      return new Cesium.Viewer('cesiumContainer', {
        imageryProvider: new Cesium.UrlTemplateImageryProvider({
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maximumLevel: 19,
        }),
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
    overlays.cartoLightLabels.alpha = 0.65;
    overlays.arcgisOverlay.alpha = 0.95;
    overlays.railOverlay.alpha = 0;
    overlays.railOverlay.show = false;
    return overlays;
  }

  function createStyleManager(viewer, initialBaseLayer) {
    let overlays = null;
    let koreaSubwayOverlay = null;

    const baseLayers = {
      satellite: initialBaseLayer,
      roadmap: viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
        maximumLevel: 20,
        credit: 'CARTO / OpenStreetMap contributors',
      }), 0),
      terrain: viewer.imageryLayers.addImageryProvider(new Cesium.ArcGisMapServerImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer',
        enablePickFeatures: false,
      }), 0),
    };

    Object.entries(baseLayers).forEach(([key, layer]) => {
      layer.show = key === DEFAULT_STYLE;
      layer.alpha = key === DEFAULT_STYLE ? 1 : 0;
    });

    function applyBaseLayerTuning(style) {
      Object.values(baseLayers).forEach(layer => {
        layer.brightness = 1.0;
        layer.contrast = 1.0;
        layer.gamma = 1.0;
        layer.saturation = 1.0;
      });
      const active = baseLayers[style];
      if (!active) return;
      if (style === 'satellite') {
        active.brightness = 1.03;
        active.contrast = 1.1;
        active.gamma = 0.96;
        active.saturation = 1.04;
      } else if (style === 'terrain') {
        active.brightness = 1.02;
        active.contrast = 1.06;
        active.gamma = 0.99;
        active.saturation = 1.02;
      }
    }

    function syncOverlayVisibility(style) {
      if (!overlays) return;
      const isSatellite = style === 'satellite';
      overlays.arcgisLabels.show = isSatellite;
      overlays.arcgisLabels.alpha = isSatellite ? 0.92 : 0;
      overlays.arcgisOverlay.show = isSatellite;
      overlays.arcgisOverlay.alpha = isSatellite ? 0.95 : 0;
      const isRoadmap = style === 'roadmap';
      overlays.cartoLightLabels.show = isRoadmap;
      overlays.cartoLightLabels.alpha = isRoadmap ? 0.82 : 0;
      overlays.railOverlay.show = false;
      overlays.railOverlay.alpha = 0;
      // 일반 지도: 지하철 표시 / 위성 등 다른 스타일: 지하철 숨김
      if (koreaSubwayOverlay) koreaSubwayOverlay.setVisible(style === 'roadmap');
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
      wireProviderRecovery() {
        const fallbackToSatellite = () => {
          Object.entries(baseLayers).forEach(([name, layer]) => {
            const active = name === 'satellite';
            layer.show = active;
            layer.alpha = active ? 1 : 0;
          });
          applyBaseLayerTuning('satellite');
          if (koreaSubwayOverlay) koreaSubwayOverlay.setVisible(false);
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
        const key = baseLayers[style] ? style : DEFAULT_STYLE;
        Object.entries(baseLayers).forEach(([name, layer]) => {
          const active = name === key;
          layer.show = active;
          layer.alpha = active ? 1 : 0;
        });
        applyBaseLayerTuning(key);
        syncOverlayVisibility(key);
        return key;
      },
    };
    manager.wireProviderRecovery();
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
    const CACHE_KEY = 'worldmap:korea-subway-overlay:v24';
    const CACHE_TTL = 1000 * 60 * 60 * 24 * 7;
    const dataSource = new Cesium.CustomDataSource('korea-subway-overlay');
    dataSource.show = false;
    viewer.dataSources.add(dataSource);

    const lineColorMap = {
      '1호선': '#0D3692', '2호선': '#33A23D', '3호선': '#FE5B10', '4호선': '#32A1C8',
      '5호선': '#8B50A4', '6호선': '#C55C1D', '7호선': '#54640D', '8호선': '#F14C82',
      '9호선': '#BDB092', '공항철도': '#0090D2', '공항철도선': '#0090D2', '신분당선': '#D31145',
      '수인분당선': '#F5A200', '수인·분당선': '#F5A200', '경의중앙선': '#77C4A3', '경춘선': '#0C8E72',
      '서해선': '#8FC31F', '신림선': '#6789CA', '우이신설선': '#B7C452', '김포골드라인': '#A17800',
      '의정부경전철': '#FDA600', '에버라인': '#6FB245', '인천1호선': '#7CA8D5', '인천2호선': '#ED8B00',
      '부산1호선': '#F06A00', '부산2호선': '#81BF48', '부산3호선': '#BB8C00', '부산4호선': '#2D9EDB',
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
      return tags.name || tags.ref || tags.line || tags.route || '지하철';
    }

    function parseCached() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || !cached.timestamp || !cached.data) return null;
        return { data: cached.data, expired: Date.now() - cached.timestamp > CACHE_TTL };
      } catch (error) {
        console.warn('subway cache parse failed', error);
        return null;
      }
    }

    function storeCache(data) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
      } catch (error) {
        console.warn('subway cache store failed', error);
      }
    }

    // 병합 비교용 키: 괄호 제거 + 역 제거
    function getStationLabelKey(name = '') {
      return String(name).trim()
        .replace(/\s*[\(（][^\)）]*[\)）]/g, '')
        .replace(/역$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // 표시용 이름: 괄호 제거 + 역 suffix 보장
    function normalizeStationDisplayName(name = '') {
      const cleaned = String(name).trim()
        .replace(/\s*[\(（][^\)）]*[\)）]/g, '')
        .replace(/역$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned ? cleaned + '역' : '';
    }

    function getStationDistanceMeters(a, b) {
      const avgLat = (((a && a.lat) || 0) + ((b && b.lat) || 0)) / 2;
      const latScale = 111320;
      const lonScale = Math.cos(Cesium.Math.toRadians(avgLat)) * 111320;
      const dx = (((a && a.lon) || 0) - ((b && b.lon) || 0)) * lonScale;
      const dy = (((a && a.lat) || 0) - ((b && b.lat) || 0)) * latScale;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // 노선 색상 점 canvas 생성 (각 노선 색상 원)
    function makeLineDotsCanvas(lines) {
      try {
        const dotR = 5;
        const gap = 3;
        const n = lines.length;
        const w = n * (dotR * 2) + Math.max(0, n - 1) * gap;
        const h = dotR * 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(w, 1);
        canvas.height = Math.max(h, 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        lines.forEach((l, i) => {
          const cx = i * (dotR * 2 + gap) + dotR;
          ctx.beginPath();
          ctx.arc(cx, dotR, dotR - 0.75, 0, Math.PI * 2);
          ctx.fillStyle = l.color || '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        return canvas;
      } catch (e) {
        console.warn('makeLineDotsCanvas failed:', e);
        return null;
      }
    }

    function addEntities(dataset) {
      if (!dataset) return;
      dataSource.entities.removeAll();
      (dataset.lines || []).forEach((line) => {
        if (!Array.isArray(line.positions) || line.positions.length < 2) return;
        dataSource.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(line.positions.flat()),
            width: 3.5,
            material: Cesium.Color.fromCssColorString(line.color || '#4B8BFF').withAlpha(0.92),
            clampToGround: true,
          },
          properties: { kind: 'subway-line', name: line.name || '지하철' },
        });
      });

      // ── 역 병합: 이름 + 근접도 기준 ──────────────────────────────
      const mergedStations = [];
      (dataset.stations || []).forEach((station) => {
        if (!Number.isFinite(station.lon) || !Number.isFinite(station.lat)) return;
        const labelKey = getStationLabelKey(station.name);
        if (!labelKey) return;

        // 같은 이름 & 800m 이내 OR 300m 이내(이름 무관) → 기존 역에 병합
        const existing = mergedStations.find((item) => {
          const dist = getStationDistanceMeters(item, station);
          return (item.key === labelKey && dist <= 800) || dist <= 150;
        });

        if (existing) {
          // 좌표 평균
          existing.lon = (existing.lon + station.lon) / 2;
          existing.lat = (existing.lat + station.lat) / 2;
          // displayName 갱신: 항상 정규화된 이름 사용
          existing.displayName = normalizeStationDisplayName(existing.name);
          // 노선 추가: 이름 & 색상 모두 유효하고 중복 없는 경우만
          if (station.line && station.color && station.color !== '#ffffff' && station.color !== '#4B8BFF') {
            const dup = existing.lines.some(
              l => l.line === station.line || l.color.toLowerCase() === station.color.toLowerCase()
            );
            if (!dup) existing.lines.push({ line: station.line, color: station.color });
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

      // ── lines 배열 최종 정리: 색상 기준 중복 제거(대소문자 무시) ──
      mergedStations.forEach((s) => {
        const seenColors = new Set();
        s.lines = s.lines.filter((l) => {
          const key = (l.color || '').toLowerCase();
          if (seenColors.has(key)) return false;
          seenColors.add(key);
          return true;
        });
      });

      // ── mergedStations 자체 중복 제거 (동일 이름·근접 역이 혹시 2개라면 합산) ──
      for (let i = mergedStations.length - 1; i >= 0; i--) {
        for (let j = 0; j < i; j++) {
          const a = mergedStations[j], b = mergedStations[i];
          const dist = getStationDistanceMeters(a, b);
          if ((a.key === b.key && dist <= 800) || dist <= 80) {
            // b → a에 병합
            b.lines.forEach((l) => {
              const dup = a.lines.some((al) => al.color.toLowerCase() === l.color.toLowerCase());
              if (!dup) a.lines.push(l);
            });
            mergedStations.splice(i, 1);
            break;
          }
        }
      }

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
      mergedStations.forEach((station) => {
        // 노선이 없으면 기본 색상 1개
        const lines = station.lines.length > 0
          ? station.lines
          : [{ line: '', color: '#4B8BFF' }];

        const dotsCanvas = makeLineDotsCanvas(lines);

        // 역명 라벨 (지도 위치 기준 위쪽)
        dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
          label: {
            text: station.displayName || normalizeStationDisplayName(station.name) || '',
            font: '12px sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString('#0f172a'),
            outlineWidth: 3,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, -22),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(5000, 1.0, 150000, 0.45),
            translucencyByDistance: new Cesium.NearFarScalar(7000, 1.0, 220000, 0.0),
          },
          properties: { kind: 'subway-station', name: station.name || '', line: lines.map(l => l.line).join(',') },
        });

        // 노선 색상 점 (역명 바로 아래 ~ 지도 위치 위쪽)
        if (!dotsCanvas) return; // canvas 생성 실패 시 건너뜀
        dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat),
          billboard: {
            image: dotsCanvas,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(5000, 1.0, 150000, 0.45),
            translucencyByDistance: new Cesium.NearFarScalar(7000, 1.0, 220000, 0.0),
          },
        });
      });
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
      const railway = String(tags.railway || '').toLowerCase();
      const publicTransport = String(tags.public_transport || '').toLowerCase();
      const station = String(tags.station || '').toLowerCase();
      const text = [tags.name, tags.network, tags.operator, tags.line, tags.ref].filter(Boolean).join(' ');
      return !!(tags.name && (
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
      // 노선별 중복 방지
      const dedupeKey = name + ':' + resolvedLine + ':' + point.lon.toFixed(5) + ':' + point.lat.toFixed(5);
      if (stationSeen.has(dedupeKey)) return;
      stationSeen.add(dedupeKey);
      // 이름 기준 중복 방지 (좌표 오차로 인한 미스매치 방지)
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
        const members = Array.isArray(relation.members) ? relation.members : [];
        const color = resolveColor(tags);
        const name = resolveLineName(tags) || relationText(tags) || '지하철';

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

          // 역이 없거나 역 관련 role이 아닌 way는 모두 선로로 포함
          // (차량기지 필터는 제거 - 끊김 현상 방지)
          lines.push({ name, color, positions: way.geometry.map((pos) => [pos.lon, pos.lat]) });
        });
      });

      // 관계에 포함된 노드 중 추가 누락분 보완 (이미 위치 기준으로 등록된 역은 스킵)
      elements.forEach((el) => {
        if (el.type !== 'node' || !Number.isFinite(el.lon) || !Number.isFinite(el.lat)) return;
        const tags = el.tags || {};
        const isStation = selectedMemberNodeIds.has(el.id) || nodeLooksLikeStation(tags);
        if (!isStation) return;
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
        stations.push({
          name: station.name || station.nameKo || '',
          lon: Number(station.lon),
          lat: Number(station.lat),
          line: station.line || '',
          color: station.color || resolveColor({ ref: station.line || '', name: station.line || '' }),
        });
      });

      return { lines, stations };
    }

    async function fetchOverpass(query) {
      const endpoints = [
        DATA_URL,
        'https://overpass.kumi.systems/api/interpreter'
      ];
      let lastError = null;
      for (const endpoint of endpoints) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000); // 20초 타임아웃
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!response.ok) throw new Error('HTTP ' + response.status + ' @ ' + endpoint);
          return await response.json();
        } catch (error) {
          clearTimeout(timer);
          lastError = error;
          console.warn('overpass endpoint failed:', endpoint, error);
        }
      }
      throw lastError || new Error('No overpass endpoint available');
    }

    function getFallbackDataset() {
      const fallbackStations = Array.isArray(window.KR_SUBWAY_STATIONS) ? window.KR_SUBWAY_STATIONS : [];
      return {
        lines: [],
        stations: fallbackStations.map((station) => ({
          name: station.name || station.nameKo || '',
          lat: Number(station.lat),
          lon: Number(station.lon),
          line: station.line || '',
          color: station.color || '#ffffff',
        })),
      };
    }

    async function load() {
      // ① 정적 데이터 즉시 표시 — 항상 실행, 오류 격리
      try {
        const fallback = getFallbackDataset();
        if (fallback.stations.length) addEntities(fallback);
      } catch (e) { console.warn('subway static fallback failed:', e); }

      // ② 유효 캐시가 있으면 교체
      let cached = null;
      try {
        cached = parseCached();
        if (cached) {
          addEntities(cached.data);
          if (!cached.expired) return;
        }
      } catch (e) { console.warn('subway cache load failed:', e); }

      // ③ 백그라운드 Overpass 갱신
      const query = `
[out:json][timeout:90];
area["ISO3166-1"="KR"][admin_level=2]->.searchArea;
(
  relation(area.searchArea)["type"="route"]["route"~"subway|light_rail|monorail|train"];
);
out body;
>;
out geom qt;`;
      try {
        const raw = await fetchOverpass(query);
        const transformed = transformOverpass(raw);
        addEntities(transformed);
        storeCache(transformed);
      } catch (error) {
        console.warn('Korea subway Overpass failed, keeping current display:', error);
      }
    }

    load();

    return {
      setVisible(visible) {
        dataSource.show = !!visible;
        viewer.scene.requestRender();
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
    scene.globe.maximumScreenSpaceError = isMobile ? 1.5 : 1.2;
    scene.globe.preloadAncestors = true;
    scene.globe.loadingDescendantsLimit = isMobile ? 4 : 8;
    scene.skyAtmosphere.show = false;
    scene.sun.show = false;
    scene.moon.show = false;
    scene.fog.enabled = false;
    scene.backgroundColor = Cesium.Color.BLACK;
    scene.highDynamicRange = false;
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Infinity;
    if (scene.postProcessStages && scene.postProcessStages.fxaa) scene.postProcessStages.fxaa.enabled = true;
    scene.fxaa = true;

    viewer.resolutionScale = isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.4);
    viewer.targetFrameRate = isMobile ? 45 : 60;

    const controller = scene.screenSpaceCameraController;
    controller.maximumZoomDistance = HOME_VIEW.alt;
    controller.minimumZoomDistance = 500;
    controller.enableCollisionDetection = false;
    controller.maximumTiltAngle = Cesium.Math.toRadians(90);
    controller.inertiaSpin = isMobile ? 0.4 : 0.62;
    controller.inertiaTranslate = isMobile ? 0.48 : 0.7;
    controller.inertiaZoom = isMobile ? 0.45 : 0.64;
    controller.maximumMovementRatio = isMobile ? 0.08 : 0.16;
    controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];

    viewer.camera.percentageChanged = 0.01;
  }

  function wireLoading(scene) {
    const loading = document.getElementById('loading');
    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      loading.classList.add('out');
      setTimeout(() => loading.classList.add('gone'), 700);
    }
    scene.globe.tileLoadProgressEvent.addEventListener(count => { if (count === 0) dismiss(); });
    setTimeout(dismiss, 4500);
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

    function altToZoom(height) {
      const z = Math.round(19 - Math.log2(Math.max(1, height) / 300));
      return Math.max(0, Math.min(MAX_Z, z));
    }

    function formatAltitude(height) {
      if (height >= 1e6) return (height / 1e6).toFixed(2) + ' Mm';
      if (height >= 1e3) return (height / 1e3).toFixed(1) + ' km';
      return height.toFixed(0) + ' m';
    }

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
      if (window.matchMedia('(max-width: 768px)').matches) return;
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

    function updateFromCartesian(cartesian, pointer, screenPosition) {
      const cameraPosition = viewer.camera.positionCartographic;
      if (!cameraPosition) return;
      const zoom = altToZoom(cameraPosition.height);
      ziVal.textContent = 'Z' + zoom;
      ziFill.style.height = Math.round((zoom / MAX_Z) * 100) + '%';
      ibAlt.textContent = formatAltitude(cameraPosition.height);
      if (ibZoom) ibZoom.textContent = 'Z' + zoom;
      if (!cartesian || !pointer) return;

      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      ibLat.textContent = (lat >= 0 ? 'N ' : 'S ') + Math.abs(lat).toFixed(4) + '°';
      ibLon.textContent = (lon >= 0 ? 'E ' : 'W ') + Math.abs(lon).toFixed(4) + '°';

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

    scene.postRender.addEventListener(() => {
      clampCameraDistance(viewer);
      const cameraPosition = viewer.camera.positionCartographic;
      if (!cameraPosition) return;
      const zoom = altToZoom(cameraPosition.height);
      ziVal.textContent = 'Z' + zoom;
      ziFill.style.height = Math.round((zoom / MAX_Z) * 100) + '%';
      ibAlt.textContent = formatAltitude(cameraPosition.height);
      if (ibZoom) ibZoom.textContent = 'Z' + zoom;
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

  function wireHomeButton(viewer, sharedState) {
    document.getElementById('globe-home-btn').addEventListener('click', () => {
      sharedState.lastSearchResult = null;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.alt),
        orientation: {
          heading: Cesium.Math.toRadians(HOME_VIEW.heading),
          pitch: Cesium.Math.toRadians(HOME_VIEW.pitch),
          roll: HOME_VIEW.roll,
        },
        duration: 1.8,
      });
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

    let isOpen = false;
    let currentItems = [];
    let activeIndex = -1;
    let debounce = null;
    let queryToken = 0;

    function syncResultsWidth() {
      const width = Math.max(row.getBoundingClientRect().width, 280);
      results.style.width = width + 'px';
    }

    function openPanel() {
      isOpen = true;
      row.classList.add('is-open');
      panel.classList.add('is-open');
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
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
      const spanByZoom = { 5: 18, 6: 12, 7: 8, 8: 4.8, 9: 2.4, 10: 1.2, 11: 0.45, 12: 0.18, 13: 0.08, 14: 0.04 };
      // 국가는 zoom 6, 나머지는 모두 역과 동일한 zoom 14
      const defaultZoom = item.type === 'country' ? 6 : 14;
      const zoomKey = Math.max(5, Math.min(14, Number(item.zoom && item.type === 'country' ? item.zoom : defaultZoom)));
      const latSpan = spanByZoom[zoomKey] ?? 0.04;
      const lonSpan = latSpan / Math.max(0.35, Math.cos(Cesium.Math.toRadians(safeLat)));
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
            destination: Cesium.Cartesian3.fromDegrees(item.lon, safeLat, fly.altitude),
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
      const wrap = document.getElementById('search-wrap');
      if (!wrap.contains(event.target) && isOpen) {
        results.style.display = 'none';
        row.classList.remove('has-results');
      }
    });
    window.addEventListener('resize', syncResultsWidth);
    syncResultsWidth();
  }

  function wireShare(viewer, sharedState, styleManager) {
    const toast = document.getElementById('toast');
    const copyBtn = document.getElementById('copy-link-btn');
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

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
    viewer.camera.moveEnd.addEventListener(syncHash);
    syncHash();
  }



  function closeOtherPanels(exceptId) {
    document.querySelectorAll('.tool-panel.open').forEach((panel) => {
      if (!exceptId || panel.id !== exceptId) panel.classList.remove('open');
    });
  }

  function wirePanelExclusivity() {
    document.addEventListener('click', (event) => {
      const target = event.target;
      const inPanel = target.closest('.tool-panel');
      const isToggle = target.closest('#style-toggle-btn, #favorites-toggle-btn');
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
    btn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('이 브라우저는 현재 위치 기능을 지원하지 않습니다.');
        return;
      }
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 7000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.6,
          complete: () => { btn.disabled = false; },
        });
      }, error => {
        btn.disabled = false;
        alert('현재 위치를 가져오지 못했습니다. 위치 권한을 확인해 주세요.');
        console.warn(error);
      }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 });
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
    viewer.camera.changed.addEventListener(draw);
    window.addEventListener('resize', draw);
    draw();
  }

  function wireFavorites(viewer, sharedState) {
    const btn = document.getElementById('favorites-toggle-btn');
    const panel = document.getElementById('favorites-panel');
    const list = document.getElementById('favorites-list');
    const addCurrentBtn = document.getElementById('fav-add-current');
    const addManualBtn = document.getElementById('fav-add-manual');
    const nameInput = document.getElementById('fav-name');
    const coordsInput = document.getElementById('fav-coords');
    const postalInput = document.getElementById('fav-postal');
    const editIdInput = document.getElementById('fav-edit-id');

    let favorites = loadFavorites();

    function togglePanel() {
      const willOpen = !panel.classList.contains('open');
      closeOtherPanels(willOpen ? panel.id : null);
      panel.classList.toggle('open', willOpen);
      if (willOpen) {
        requestAnimationFrame(() => positionPanelNearButton(panel, btn));
      }
    }
    btn.addEventListener('click', (event) => { event.stopPropagation(); togglePanel(); });
    panel.addEventListener('click', (event) => event.stopPropagation());
    window.addEventListener('resize', () => {
      if (panel.classList.contains('open')) positionPanelNearButton(panel, btn);
    });

    function saveFavorites() { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); }
    function resetForm() {
      editIdInput.value = '';
      nameInput.value = '';
      coordsInput.value = '';
      postalInput.value = '';
    }

    function renderFavorites() {
      if (!favorites.length) {
        list.innerHTML = '<div class="fav-empty">저장된 위치가 없습니다.</div>';
        return;
      }
      list.innerHTML = '';
      favorites.forEach(item => {
        const el = document.createElement('div');
        el.className = 'fav-item';
        el.innerHTML = `
          <div class="fav-text">
            <div class="fav-name">${escapeHtml(item.name)}</div>
            <div class="fav-sub">${escapeHtml(item.sourceLabel || `${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}`)}</div>
          </div>
          <div class="fav-actions">
            <button type="button" data-go="${item.id}">이동</button>
            <button type="button" data-edit="${item.id}">수정</button>
            <button type="button" data-del="${item.id}">삭제</button>
          </div>
        `;
        list.appendChild(el);
      });

      list.querySelectorAll('[data-go]').forEach(btn => btn.addEventListener('click', () => {
        const item = favorites.find(f => f.id === btn.dataset.go);
        if (!item) return;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, item.alt || 85000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.4,
        });
      }));
      list.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
        const item = favorites.find(f => f.id === btn.dataset.edit);
        if (!item) return;
        editIdInput.value = item.id;
        nameInput.value = item.name;
        coordsInput.value = item.lat.toFixed(6) + ', ' + item.lon.toFixed(6);
        postalInput.value = item.postalCode || '';
      }));
      list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => {
        favorites = favorites.filter(f => f.id !== btn.dataset.del);
        saveFavorites();
        renderFavorites();
        if (editIdInput.value === btn.dataset.del) resetForm();
      }));
    }

    function makeUniqueFavoriteName(baseName, ignoreId = '') {
      const fallback = String(baseName || '').trim() || '선택 위치';
      const normalizedBase = fallback.trim().toLowerCase();
      const existingNames = new Set(
        favorites
          .filter(item => !ignoreId || item.id !== ignoreId)
          .map(item => String(item.name || '').trim().toLowerCase())
      );

      if (!existingNames.has(normalizedBase)) {
        return fallback;
      }

      let suffix = 2;
      while (existingNames.has((fallback + ' ' + suffix).trim().toLowerCase())) {
        suffix += 1;
      }
      return `${fallback} ${suffix}`;
    }

    function buildAutoFavoriteName(place, lat, lon) {
      const country = String(place?.country || '').trim();
      const city = String(place?.city || '').trim();
      const label = String(place?.label || '').trim();
      const base = (country && city)
        ? `${country} - ${city}`
        : (country || city || label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      return makeUniqueFavoriteName(base);
    }

    function upsertFavorite(payload) {
      const nextPayload = { ...payload };
      nextPayload.name = String(nextPayload.name || '').trim() || '선택 위치';

      if (editIdInput.value) {
        nextPayload.name = makeUniqueFavoriteName(nextPayload.name, editIdInput.value);
        favorites = favorites.map(item => item.id === editIdInput.value ? { ...item, ...nextPayload, id: item.id } : item);
      } else {
        nextPayload.name = makeUniqueFavoriteName(nextPayload.name);
        const duplicate = favorites.find(item => Math.abs(item.lat - nextPayload.lat) < 0.00001 && Math.abs(item.lon - nextPayload.lon) < 0.00001);
        if (!duplicate) {
          favorites.unshift({ id: 'fav_' + Date.now(), ...nextPayload });
        }
      }
      saveFavorites();
      renderFavorites();
      resetForm();
    }

    async function saveFavoriteAtLocation(lat, lon, options = {}) {
      const place = options.place || await window.WorldSearch.reverseGeocode(lat, lon).catch(() => null);
      const manualName = String(options.name || '').trim();
      const name = manualName || buildAutoFavoriteName(place, lat, lon);
      const sourceLabel = options.sourceLabel || place?.label || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      upsertFavorite({ name, lat, lon, alt: options.alt || 85000, sourceLabel });
      return { name, sourceLabel };
    }

    sharedState.saveFavoriteAtLocation = saveFavoriteAtLocation;

    addCurrentBtn.addEventListener('click', async () => {
      const inputName = (nameInput.value || '').trim();
      const carto = viewer.camera.positionCartographic;
      if (!carto) return;
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      let place = null;
      let sourceLabel = '';
      try {
        place = await window.WorldSearch.reverseGeocode(lat, lon);
        sourceLabel = place?.label || '';
      } catch (error) { console.warn(error); }
      const name = inputName || buildAutoFavoriteName(place, lat, lon);
      upsertFavorite({ name, lat, lon, alt: carto.height, sourceLabel });
    });

    addManualBtn.addEventListener('click', async () => {
      const name = (nameInput.value || '').trim();
      if (!name) {
        alert('즐겨찾기 이름을 입력해 주세요.');
        return;
      }
      const coords = parseLatLon(coordsInput.value);
      if (coords) {
        upsertFavorite({ name, lat: coords.lat, lon: coords.lon, alt: 85000, sourceLabel: '직접 좌표 입력' });
        return;
      }
      const postal = (postalInput.value || '').trim();
      if (!postal) {
        alert('위도/경도 또는 우편번호를 입력해 주세요.');
        return;
      }
      try {
        const resolved = await geocodePostal(postal);
        if (!resolved) {
          alert('우편번호 위치를 찾지 못했습니다.');
          return;
        }
        upsertFavorite({ name, lat: resolved.lat, lon: resolved.lon, alt: 85000, postalCode: postal, sourceLabel: resolved.label || '우편번호 입력' });
      } catch (error) {
        console.warn(error);
        alert('우편번호 위치를 찾지 못했습니다.');
      }
    });

    const middleHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    middleHandler.setInputAction(async movement => {
      const screenPos = movement.position;
      const cartesian = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      if (!cartographic) return;
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      try {
        await saveFavoriteAtLocation(lat, lon, { alt: viewer.camera.positionCartographic?.height || 85000 });
      } catch (error) {
        console.warn(error);
      }
    }, Cesium.ScreenSpaceEventType.MIDDLE_CLICK);

    renderFavorites();
  }

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (error) {
      return [];
    }
  }

  function parseLatLon(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parts = text.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  }

  async function geocodePostal(postal) {
    const url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&langCode=KO&outFields=*&singleLine=' + encodeURIComponent(postal);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const data = await response.json();
    const item = Array.isArray(data.candidates) ? data.candidates[0] : null;
    if (!item || !item.location) return null;
    return {
      lat: Number(item.location.y),
      lon: Number(item.location.x),
      label: item.address || item.attributes?.LongLabel || postal,
    };
  }

  function wireMobileGestures(viewer) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return;
    const controller = viewer.scene.screenSpaceCameraController;
    controller.bounceAnimationTime = 0;
    controller.inertiaSpin = 0.28;
    controller.inertiaTranslate = 0.35;
    controller.inertiaZoom = 0.35;
    viewer.scene.canvas.style.touchAction = 'none';

    // 터치 선택 효과(파란 하이라이트) 방지
    viewer.scene.canvas.style.webkitTapHighlightColor = 'transparent';
    viewer.scene.canvas.style.userSelect = 'none';
    viewer.scene.canvas.style.webkitUserSelect = 'none';
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    let pinchActive = false;
    viewer.scene.canvas.addEventListener('touchstart', event => {
      pinchActive = event.touches.length >= 2;
    }, { passive: true });
    viewer.scene.canvas.addEventListener('touchend', event => {
      pinchActive = event.touches.length >= 2;
    }, { passive: true });
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
