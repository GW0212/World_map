(function () {
  'use strict';

  const fallbackStations = [
    { name: '인천논현역', lat: 37.400614, lon: 126.722481, line: '수인분당선', color: '#F5A200', aliases: ['인천논현', '인천 논현'] },
    { name: '소래포구역', lat: 37.400943, lon: 126.733522, line: '수인분당선', color: '#F5A200', aliases: ['소래포구'] },
    { name: '호구포역', lat: 37.389848, lon: 126.708842, line: '수인분당선', color: '#F5A200', aliases: ['호구포'] },
    { name: '남동인더스파크역', lat: 37.407366, lon: 126.695287, line: '수인분당선', color: '#F5A200', aliases: ['남동인더스파크'] },
    { name: '원인재역', lat: 37.412074, lon: 126.686796, line: '수인분당선', color: '#F5A200', aliases: ['원인재'] }
  ];

  if (!Array.isArray(window.KR_SUBWAY_STATIONS)) {
    window.KR_SUBWAY_STATIONS = [];
  }

  function mergeStations(base, extra) {
    const result = Array.isArray(base) ? base.slice() : [];
    const seen = new Set(result.map((item) => String((item && (item.name || item.nameKo || ''))).trim() + ':' + Number((item && item.lat) || 0).toFixed(5) + ':' + Number((item && item.lon) || 0).toFixed(5)));
    (Array.isArray(extra) ? extra : []).forEach((item) => {
      const key = String((item && (item.name || item.nameKo || ''))).trim() + ':' + Number((item && item.lat) || 0).toFixed(5) + ':' + Number((item && item.lon) || 0).toFixed(5);
      if (!String((item && (item.name || item.nameKo || ''))).trim() || seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  window.setKrSubwayStations = function setKrSubwayStations(stations) {
    window.KR_SUBWAY_STATIONS = mergeStations(stations, fallbackStations);
    return window.KR_SUBWAY_STATIONS;
  };

  window.KR_SUBWAY_STATIONS = mergeStations(window.KR_SUBWAY_STATIONS, fallbackStations);
}());
