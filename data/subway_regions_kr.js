(function () {
  'use strict';

  // 전국 지하철/도시철도 보정 데이터.
  // Overpass가 지역별 상세 데이터를 받아오기 전에도 부산/대구/대전/광주 노선이 공백으로 보이지 않도록 핵심 축을 즉시 표시한다.
  const stations = [
    { name: '노포역', lat: 35.2836, lon: 129.0957, line: '부산1호선', color: '#F06A00' },
    { name: '동래역', lat: 35.2050, lon: 129.0780, line: '부산1호선', color: '#F06A00' },
    { name: '연산역', lat: 35.1860, lon: 129.0810, line: '부산1호선', color: '#F06A00' },
    { name: '서면역', lat: 35.1578, lon: 129.0592, line: '부산1호선', color: '#F06A00' },
    { name: '부산역', lat: 35.1152, lon: 129.0417, line: '부산1호선', color: '#F06A00' },
    { name: '남포역', lat: 35.0980, lon: 129.0340, line: '부산1호선', color: '#F06A00' },
    { name: '하단역', lat: 35.1060, lon: 128.9660, line: '부산1호선', color: '#F06A00' },
    { name: '다대포해수욕장역', lat: 35.0480, lon: 128.9650, line: '부산1호선', color: '#F06A00' },
    { name: '장산역', lat: 35.1690, lon: 129.1760, line: '부산2호선', color: '#81BF48' },
    { name: '해운대역', lat: 35.1632, lon: 129.1584, line: '부산2호선', color: '#81BF48' },
    { name: '센텀시티역', lat: 35.1693, lon: 129.1297, line: '부산2호선', color: '#81BF48' },
    { name: '수영역', lat: 35.1660, lon: 129.1150, line: '부산2호선', color: '#81BF48' },
    { name: '사상역', lat: 35.1624, lon: 128.9843, line: '부산2호선', color: '#81BF48' },
    { name: '덕천역', lat: 35.2100, lon: 129.0050, line: '부산2호선', color: '#81BF48' },
    { name: '양산역', lat: 35.3380, lon: 129.0260, line: '부산2호선', color: '#81BF48' },
    { name: '미남역', lat: 35.2050, lon: 129.0680, line: '부산3호선', color: '#BB8C00' },
    { name: '구포역', lat: 35.2060, lon: 129.0030, line: '부산3호선', color: '#BB8C00' },
    { name: '대저역', lat: 35.2150, lon: 128.9620, line: '부산3호선', color: '#BB8C00' },
    { name: '충렬사역', lat: 35.2010, lon: 129.0980, line: '부산4호선', color: '#2D9EDB' },
    { name: '반여농산물시장역', lat: 35.2180, lon: 129.1240, line: '부산4호선', color: '#2D9EDB' },
    { name: '안평역', lat: 35.2350, lon: 129.1740, line: '부산4호선', color: '#2D9EDB' },
    { name: '김해공항역', lat: 35.1710, lon: 128.9480, line: '부산김해경전철', color: '#875CAC' },
    { name: '김해시청역', lat: 35.2280, lon: 128.8900, line: '부산김해경전철', color: '#875CAC' },
    { name: '가야대역', lat: 35.2650, lon: 128.8660, line: '부산김해경전철', color: '#875CAC' },

    { name: '설화명곡역', lat: 35.7980, lon: 128.4890, line: '대구1호선', color: '#D93F5C' },
    { name: '상인역', lat: 35.8180, lon: 128.5360, line: '대구1호선', color: '#D93F5C' },
    { name: '반월당역', lat: 35.8658, lon: 128.5933, line: '대구1호선', color: '#D93F5C' },
    { name: '칠성시장역', lat: 35.8761, lon: 128.6031, line: '대구1호선', color: '#D93F5C' },
    { name: '대구역', lat: 35.8798, lon: 128.6288, line: '대구1호선', color: '#D93F5C' },
    { name: '동대구역', lat: 35.8778, lon: 128.6286, line: '대구1호선', color: '#D93F5C' },
    { name: '안심역', lat: 35.8710, lon: 128.7330, line: '대구1호선', color: '#D93F5C' },
    { name: '문양역', lat: 35.8640, lon: 128.4370, line: '대구2호선', color: '#00A84D' },
    { name: '계명대역', lat: 35.8550, lon: 128.4910, line: '대구2호선', color: '#00A84D' },
    { name: '범어역', lat: 35.8590, lon: 128.6270, line: '대구2호선', color: '#00A84D' },
    { name: '사월역', lat: 35.8370, lon: 128.7150, line: '대구2호선', color: '#00A84D' },
    { name: '영남대역', lat: 35.8360, lon: 128.7540, line: '대구2호선', color: '#00A84D' },
    { name: '칠곡경대병원역', lat: 35.9580, lon: 128.5590, line: '대구3호선', color: '#F4A116' },
    { name: '팔거역', lat: 35.9440, lon: 128.5580, line: '대구3호선', color: '#F4A116' },
    { name: '만평역', lat: 35.8910, lon: 128.5610, line: '대구3호선', color: '#F4A116' },
    { name: '서문시장역', lat: 35.8690, lon: 128.5820, line: '대구3호선', color: '#F4A116' },
    { name: '명덕역', lat: 35.8560, lon: 128.5900, line: '대구3호선', color: '#F4A116' },
    { name: '수성구민운동장역', lat: 35.8520, lon: 128.6240, line: '대구3호선', color: '#F4A116' },
    { name: '용지역', lat: 35.8240, lon: 128.6460, line: '대구3호선', color: '#F4A116' },

    { name: '판암역', lat: 36.3160, lon: 127.4590, line: '대전1호선', color: '#007448' },
    { name: '대전역', lat: 36.3320, lon: 127.4340, line: '대전1호선', color: '#007448' },
    { name: '중앙로역', lat: 36.3270, lon: 127.4250, line: '대전1호선', color: '#007448' },
    { name: '시청역', lat: 36.3510, lon: 127.3840, line: '대전1호선', color: '#007448' },
    { name: '정부청사역', lat: 36.3580, lon: 127.3810, line: '대전1호선', color: '#007448' },
    { name: '유성온천역', lat: 36.3530, lon: 127.3420, line: '대전1호선', color: '#007448' },
    { name: '반석역', lat: 36.3922, lon: 127.3144, line: '대전1호선', color: '#007448' },

    { name: '평동역', lat: 35.1280, lon: 126.7680, line: '광주1호선', color: '#0090D2' },
    { name: '광주송정역', lat: 35.1376, lon: 126.7934, line: '광주1호선', color: '#0090D2' },
    { name: '김대중컨벤션센터역', lat: 35.1430, lon: 126.8420, line: '광주1호선', color: '#0090D2' },
    { name: '상무역', lat: 35.1547, lon: 126.8473, line: '광주1호선', color: '#0090D2' },
    { name: '농성역', lat: 35.1535, lon: 126.8876, line: '광주1호선', color: '#0090D2' },
    { name: '금남로4가역', lat: 35.1466, lon: 126.9180, line: '광주1호선', color: '#0090D2' },
    { name: '남광주역', lat: 35.1390, lon: 126.9220, line: '광주1호선', color: '#0090D2' },
    { name: '소태역', lat: 35.1230, lon: 126.9320, line: '광주1호선', color: '#0090D2' }
  ];

  const pick = (line) => stations
    .filter(station => station.line === line)
    .map(station => [station.lon, station.lat]);

  const lines = [
    { name: '부산1호선', color: '#F06A00', positions: pick('부산1호선') },
    { name: '부산2호선', color: '#81BF48', positions: pick('부산2호선') },
    { name: '부산3호선', color: '#BB8C00', positions: pick('부산3호선') },
    { name: '부산4호선', color: '#2D9EDB', positions: pick('부산4호선') },
    { name: '부산김해경전철', color: '#875CAC', positions: pick('부산김해경전철') },
    { name: '대구1호선', color: '#D93F5C', positions: pick('대구1호선') },
    { name: '대구2호선', color: '#00A84D', positions: pick('대구2호선') },
    { name: '대구3호선', color: '#F4A116', positions: pick('대구3호선') },
    { name: '대전1호선', color: '#007448', positions: pick('대전1호선') },
    { name: '광주1호선', color: '#0090D2', positions: pick('광주1호선') }
  ].filter(line => line.positions.length >= 2);

  window.KR_SUBWAY_REGIONAL_STATIC_OVERLAY = { lines, stations };
}());
