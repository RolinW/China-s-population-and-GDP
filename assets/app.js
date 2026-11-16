/* ==========================================================================
   中国县域经济地图 · 地图 + 树形图
   ========================================================================== */
(function () {
  'use strict';

  var TREE = window.TREE;
  var SCALES = window.SCALES;
  var TOPO = {
    province: window.TOPO_PROVINCE,
    city: window.TOPO_CITY,
    county: window.TOPO_COUNTY
  };

  var NO_DATA = '#e6e8eb';
  var state = {
    metric: 'gdp',
    view: 'map',
    level: 'province',
    selected: null,
    focus: null,
    animating: false,
    dragging: false
  };

  /* ---------------------------------------------------------------- 索引 */
  var uid = 0;
  var byCode = {};
  var residualByCity = {};

  function walk(node, parents) {
    node.__path = parents.concat(node);
    node.__id = 'n' + (++uid);
    if (node.level === 'residual') residualByCity[String(node.code)] = node;
    else byCode[String(node.code)] = node;
    (node.children || []).forEach(function (c) { walk(c, node.__path); });
  }
  walk(TREE, []);

  function val(n) { return n[state.metric] || 0; }
  function unit() { return state.metric === 'gdp' ? '亿元' : '万人'; }
  function fmt(v, digits) {
    if (v == null) return '—';
    return state.metric === 'gdp'
      ? d3.format(',.' + (digits == null ? 2 : digits) + 'f')(v)
      : d3.format(',.' + (digits == null ? 1 : digits) + 'f')(v);
  }
  function fmtGdp(v) { return v == null ? '—' : d3.format(',.2f')(v) + ' 亿元'; }
  function fmtPop(v) { return v == null ? '—' : d3.format(',.1f')(v) + ' 万人'; }

  /* ---------------------------------------------------------------- 颜色 */
  var LEVEL_SCALE = { district: 'county', residual: 'city' };

  function colorFor(value, level) {
    var lv = LEVEL_SCALE[level] || level;
    var s = SCALES[lv] && SCALES[lv][state.metric];
    if (!s || !s.max || !value || value <= 0) return NO_DATA;
    var t = Math.sqrt(value / s.max);
    var i = Math.max(0, Math.min(255, Math.round(t * 255)));
    var c = 255 - i;
    return state.metric === 'gdp'
      ? 'rgb(' + c + ',' + c + ',255)'
      : 'rgb(255,' + c + ',' + c + ')';
  }

  function textColor(fill) {
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(fill);
    if (!m) return '#1b2430';
    var lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
    return lum < 0.55 ? '#ffffff' : '#1b2430';
  }

  /* ---------------------------------------------------------------- 尺寸 */
  var stageEl = document.getElementById('stage');
  function stageSize() {
    return { w: stageEl.clientWidth, h: stageEl.clientHeight };
  }

  /* ---------------------------------------------------------------- tooltip */
  var tipEl = document.getElementById('tip');
  function showTip(html, x, y) {
    tipEl.hidden = false;
    tipEl.innerHTML = html;
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    var left = Math.min(x + 14, window.innerWidth - w - 8);
    var top = Math.min(y + 14, window.innerHeight - h - 8);
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  function hideTip() { tipEl.hidden = true; }

  /* ================================================================ 地图 */
  var mapWrap = d3.select('#mapView');
  var svgMap = null, mapG = null, layers = {};
  var projection = null, geoPath = null, GEO = null;
  var mapW = 0, mapH = 0;

    var zoom = null;
    var wheelAcc = 0;
    var mapClickTimer = null;
    var treeClickTimer = null;
    var ZOOM_STEP = 1.32;

  var CODE_KEY = { province: '省代码', city: '市代码', county: '县代码' };

  function topoFeature(name) {
    var t = TOPO[name];
    var key = Object.keys(t.objects)[0];
    return topojson.feature(t, t.objects[key]);
  }

  function initMap() {
    var size = stageSize();
    mapW = size.w;
    mapH = size.h;
    mapWrap.selectAll('*').remove();

    svgMap = mapWrap.append('svg')
      .attr('viewBox', '0 0 ' + mapW + ' ' + mapH)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    if (!GEO) {
      GEO = {
        province: topoFeature('province'),
        city: topoFeature('city'),
        county: topoFeature('county')
      };
    }

    projection = d3.geoMercator().center([104, 36]).scale(1).translate([0, 0]);
    var p1 = projection([73.5, 18]);
    var p2 = projection([135, 53.5]);
    var k = Math.min((mapW - 48) / Math.abs(p2[0] - p1[0]), (mapH - 60) / Math.abs(p2[1] - p1[1]));
    projection.scale(k).translate([
      mapW / 2 - (p1[0] + p2[0]) / 2 * k,
      mapH / 2 - (p1[1] + p2[1]) / 2 * k
    ]);
    geoPath = d3.geoPath(projection);

    mapG = svgMap.append('g').attr('class', 'mapG');

    ['province', 'city', 'county'].forEach(function (lv) {
      var layer = mapG.append('g').attr('class', 'layer ' + lv);
      layer.selectAll('path')
        .data(GEO[lv].features)
        .join('path')
        .attr('class', 'unit')
        .attr('d', geoPath)
        .attr('data-code', function (f) { return String(f.properties[CODE_KEY[lv]]); })
          .on('click', function (event, f) {
              event.stopPropagation();

              if (mapClickTimer) clearTimeout(mapClickTimer);

              mapClickTimer = setTimeout(function () {
                  mapClickTimer = null;

                  if (!state.animating && !state.dragging) {
                      showUnitDetail(lv, f);
                  }
              }, 250);
          })

          .on('dblclick', function (event, f) {
              event.preventDefault();
              event.stopPropagation();

              if (mapClickTimer) {
                  clearTimeout(mapClickTimer);
                  mapClickTimer = null;
              }

              pickUnit(lv, f);
          })

        .on('contextmenu', function (event, f) {
          event.preventDefault();
          event.stopPropagation();
          var r = resolveNode(lv, f);
          if (r && r.node) openMenu(event, r.node);
        });

      layer.on('pointerover', function (event) {
        var t = event.target;
        if (!t || t.tagName !== 'path') return;
        if (state.hovPath) state.hovPath.classed('hov', false).attr('stroke-width', null);
        state.hovPath = d3.select(t).classed('hov', true);
        updateStrokes(d3.zoomTransform(svgMap.node()).k);
      }).on('pointerout', function (event) {
        if (state.hovPath && event.target === state.hovPath.node()) {
          state.hovPath.classed('hov', false).attr('stroke-width', null);
          state.hovPath = null;
          updateStrokes(d3.zoomTransform(svgMap.node()).k);
        }
      }).on('pointermove', function (event) {
        if (state.animating || state.dragging) { hideTip(); return; }
        var f = event.target.__data__;
        if (!f || !f.properties) { hideTip(); return; }
        showMapTip(lv, f, event.clientX, event.clientY);
      }).on('pointerleave', hideTip);

      layers[lv] = layer;
    });

    state.animating = false;
    bindZoom();
    paintMap();
  }

  /* ------------------------------- 缩放：一档 200ms */
  function updateStrokes(k) {
    if (!layers.province) return;
    layers.province.attr('stroke-width', 1.0 / k);
    layers.city.attr('stroke-width', 0.8 / k);
    layers.county.attr('stroke-width', 0.55 / k);
    if (state.selPath) state.selPath.attr('stroke-width', 2.6 / k);
    if (state.hovPath) state.hovPath.attr('stroke-width', 1.7 / k);
  }

  function stepZoom(dir, event) {
    var cur = d3.zoomTransform(svgMap.node());
    var k = Math.max(1, Math.min(44, cur.k * Math.pow(ZOOM_STEP, dir)));
    if (Math.abs(k - cur.k) < 1e-4) return;
    var p = d3.pointer(event, svgMap.node());
    var x = p[0] - (p[0] - cur.x) * (k / cur.k);
    var y = p[1] - (p[1] - cur.y) * (k / cur.k);
    state.animating = true;
    hideTip();
    svgMap.classed('zooming', true);
    svgMap.transition('zoom').duration(200).ease(d3.easeCubicOut)
      .call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
  }

  function bindZoom() {
    zoom = d3.zoom()
      .scaleExtent([1, 44])
      .translateExtent([[0, 0], [mapW, mapH]])
      .on('zoom', function (event) {
        mapG.attr('transform', event.transform);
        updateStrokes(event.transform.k);
      })
      .on('start', function () { hideTip(); })
      .on('end', function () {
        svgMap.classed('zooming', false);
        state.animating = false;
        updateLevel(d3.zoomTransform(svgMap.node()).k);
      });

    svgMap.call(zoom);
    svgMap.on('dblclick.zoom', null);
    svgMap.on('wheel.zoom', null);

    svgMap.on('wheel', function (event) {
      event.preventDefault();
      // 动画进行中（或拖动中）不读取滚轮，避免打断过渡造成卡顿
      if (state.animating || state.dragging) { wheelAcc = 0; return; }
      wheelAcc += event.deltaY;
      if (Math.abs(wheelAcc) < 40) return;
      var dir = wheelAcc > 0 ? -1 : 1;
      wheelAcc = 0;
      stepZoom(dir, event);
    });

    svgMap.on('pointerdown.tip', function () { state.dragging = true; hideTip(); });
    window.addEventListener('pointerup', function () { state.dragging = false; });
  }

  /* ------------------------------- 层级与着色 */
  function levelForScale(k) {
    if (k < 2.0) return 'province';
    if (k < 6.5) return 'city';
    return 'county';
  }

  function updateLevel(k) {
    var lv = levelForScale(k);
    if (lv !== state.level) {
      state.level = lv;
      paintMap();
    }
  }

  function paintMap() {
    var lv = state.level;

    layers.province.style('display', null)
      .style('pointer-events', lv === 'province' ? 'all' : 'none');
    layers.city.style('display', lv === 'province' ? 'none' : null)
      .style('pointer-events', lv === 'city' ? 'all' : 'none');
    layers.county.style('display', lv === 'county' ? null : 'none')
      .style('pointer-events', lv === 'county' ? 'all' : 'none');

    paintLayer('province', lv === 'province');
    paintLayer('city', lv === 'city');
    paintLayer('county', lv === 'county');

    var sel = state.selected;
    layers.province.selectAll('path').classed('sel', function (f) {
      return !!sel && (sel.level === 'province' || sel.level === 'nodata') &&
        String(f.properties['省代码']) === String(sel.code);
    });
    layers.city.selectAll('path').classed('sel', function (f) {
      return !!sel && sel.level === 'city' && String(f.properties['市代码']) === String(sel.code);
    });
    layers.county.selectAll('path').classed('sel', function (f) {
      if (!sel) return false;
      if (sel.level === 'county' || sel.level === 'district') {
        return String(f.properties['县代码']) === String(sel.code);
      }
      if (sel.level === 'residual') {
        return String(f.properties['市代码']) === String(sel.code) &&
          !byCode[String(f.properties['县代码'])];
      }
      return false;
    });

    ['province', 'city', 'county'].forEach(function (x) {
      layers[x].selectAll('path').attr('stroke-width', null);
    });
    var selNodes = [];
    ['province', 'city', 'county'].forEach(function (x) {
      layers[x].selectAll('path.sel').each(function () { selNodes.push(this); });
    });
    state.selPath = selNodes.length ? d3.selectAll(selNodes) : null;
    updateStrokes(d3.zoomTransform(svgMap.node()).k);

    document.getElementById('levelTip').textContent =
      '当前层级：' + ({ province: '省', city: '市', county: '县' }[lv]) +
      (lv === 'province' ? '（滚轮放大查看市/县）' : lv === 'city' ? '（继续放大查看县）' : '');

    updateLegend(lv);
  }

  function districtAgg(f, lv) {
    if (lv !== 'county') return null;
    if (f.properties['县类型'] !== '市辖区') return null;
    if (byCode[String(f.properties['县代码'])]) return null;
    return residualByCity[String(f.properties['市代码'])] || null;
  }

  function paintLayer(lv, active) {
    layers[lv].selectAll('path').each(function (f) {
      var node = byCode[String(f.properties[CODE_KEY[lv]])];
      var el = d3.select(this);
      el.attr('stroke-opacity', active ? 1 : (lv === 'province' ? 0.9 : 0.5));
      if (!active) {
        el.attr('fill', 'none').attr('fill-opacity', null).attr('stroke-dasharray', null);
        return;
      }
      if (node) {
        el.attr('fill', colorFor(val(node), node.level))
          .attr('fill-opacity', null).attr('stroke-dasharray', null);
        return;
      }
      var agg = districtAgg(f, lv);
      if (agg) {
        el.attr('fill', colorFor(val(agg), 'residual'))
          .attr('fill-opacity', 0.55)
          .attr('stroke-dasharray', '2 2');
      } else {
        el.attr('fill', NO_DATA).attr('fill-opacity', null).attr('stroke-dasharray', null);
      }
    });
  }

  /* ------------------------------- 单位解析 */
  function resolveNode(lv, f) {
    var p = f.properties;
    var code = String(p[CODE_KEY[lv]]);
    var node = byCode[code];
    if (node) return { kind: 'unit', node: node };

    if (lv === 'county') {
      var cc = String(p['市代码']);
      var res = residualByCity[cc];
      if (res) return { kind: 'agg', node: res, name: p['县'] };
    }

    var prov = p['省'] || '';
    if (prov.indexOf('台湾') >= 0 || prov.indexOf('香港') >= 0 || prov.indexOf('澳门') >= 0) {
      return { kind: 'nodata', name: prov };
    }
    return null;
  }

    function showUnitDetail(lv, f) {
        var r = resolveNode(lv, f);
        if (!r) return;

        if (r.kind === 'nodata') {
            selectNode({
                name: r.name,
                level: 'nodata',
                code: String(f.properties[CODE_KEY[lv]])
            });
            return;
        }

        selectNode(r.node);
    }
    function pickUnit(lv, f) {
        var r = resolveNode(lv, f);
        if (!r) return;

        if (r.kind === 'nodata') {
            selectNode({
                name: r.name,
                level: 'nodata',
                code: String(f.properties[CODE_KEY[lv]])
            });
            return;
        }
        goTree(r.node);
    }

  function showMapTip(lv, f, x, y) {
    var p = f.properties;
    var name = p[lv === 'province' ? '省' : lv === 'city' ? '市' : '县'];
    var r = resolveNode(lv, f);
    var html = '<b>' + name + '</b>';
    if (!r) { showTip(html + '<br>暂无数据', x, y); return; }
    if (r.kind === 'nodata') { showTip(html + '<br>港澳台数据暂缺', x, y); return; }
    var n = r.node;
    html += '<br>GDP ' + fmtGdp(n.gdp) + '<br>人口 ' + fmtPop(n.pop);
    if (r.kind === 'agg') {
      html += '<br><span style="opacity:.75">市辖区合计（含 ' + ((r.node.districts || []).length || '?') + ' 个区）</span>';
    }
    showTip(html, x, y);
  }

  /* ================================================================ 树形图 */
  var treeWrap = d3.select('#treeView');
  var svgTree = null, treeG = null, treeW = 0, treeH = 0;

  function initTree() {
    var size = stageSize();
    treeW = size.w;
    treeH = size.h;
    treeWrap.selectAll('*').remove();
    svgTree = treeWrap.append('svg')
      .attr('viewBox', '0 0 ' + treeW + ' ' + treeH)
      .attr('preserveAspectRatio', 'xMidYMid meet');
    treeG = svgTree.append('g');
  }

  function childLevelOf(focus) {
    var counts = {};
    (focus.children || []).forEach(function (c) {
      if (val(c) <= 0 || c.level === 'residual') return;
      var lv = c.level === 'district' ? 'county' : c.level;
      counts[lv] = (counts[lv] || 0) + 1;
    });
    var best = null, n = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > n) { n = counts[k]; best = k; }
    });
    return best || 'county';
  }

  function renderTree(animate) {
    if (!svgTree) initTree();

    var focus = state.focus || TREE;
    var dur = animate ? 620 : 0;

    var root = d3.hierarchy(focus)
      .sum(function (d) {
        return (d.children && d.children.length) ? 0 : (val(d) > 0 ? val(d) : 0);
      })
      .sort(function (a, b) { return b.value - a.value; });

    var padTop = 40, padBottom = 64;
    treeG.attr('transform', 'translate(4,' + padTop + ')');

    d3.treemap()
      .tile(d3.treemapResquarify)
      .size([treeW - 8, treeH - padTop - padBottom])
      .paddingInner(1.2)
      .paddingOuter(3)
      .paddingTop(function (d) { return d.depth === 1 ? 15 : 0; })(root);

    var nodes = root.descendants().filter(function (d) { return d.depth === 1 && d.value > 0; });

    var sel = treeG.selectAll('g.tm-node').data(nodes, function (d) { return d.data.__id; });

    var enter = sel.enter().append('g')
      .attr('class', function (d) {
        return 'tm-node' + (d.data.level === 'residual' ? ' residual' : '') +
          (state.selected && state.selected.__id === d.data.__id ? ' sel' : '');
      })
      .attr('transform', function (d) { return 'translate(' + (d.x0 || 0) + ',' + (d.y0 || 0) + ')'; });

    enter.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', function (d) { return Math.max(0, d.x1 - d.x0); })
      .attr('height', function (d) { return Math.max(0, d.y1 - d.y0); })
      .attr('rx', 1.5)
      .attr('fill', function (d) { return colorFor(val(d.data), d.data.level); });

    enter.append('text').attr('class', 'n');
    enter.append('text').attr('class', 'v');
    enter.style('opacity', 0);

    sel.exit().transition().duration(dur * 0.6).style('opacity', 0).remove();

    var all = enter.merge(sel);



      all.style('cursor', 'pointer')
          .on('click', function (event, d) {
              event.stopPropagation();

              // 延迟执行单击，给双击事件留出识别时间
              if (treeClickTimer) clearTimeout(treeClickTimer);

              treeClickTimer = setTimeout(function () {
                  treeClickTimer = null;

                  if (d.data.children && d.data.children.length) {
                      state.focus = d.data;
                      renderTree(true);
                      selectNode(d.data);
                  } else {
                      selectNode(d.data);
                  }
              }, 250);
          })
          .on('dblclick', function (event, d) {
              event.preventDefault();
              event.stopPropagation();


              if (treeClickTimer) {
                  clearTimeout(treeClickTimer);
                  treeClickTimer = null;
              }

              goMap(d.data);
          })
          .on('mousemove', function (event, d) {
              var aux = state.metric === 'gdp'
                  ? { label: '人口', v: d.data.pop, text: fmtPop(d.data.pop) }
                  : { label: 'GDP', v: d.data.gdp, text: fmtGdp(d.data.gdp) };
              var html = '<b>' + d.data.name + '</b><br>' + aux.label + ' ' + aux.text;
              showTip(html, event.clientX, event.clientY);
          })
          .on('mouseleave', hideTip);
          


    all.select('rect')
      .transition().duration(dur).ease(d3.easeCubicInOut)
      .attr('fill', function (d) { return colorFor(val(d.data), d.data.level); })
      .attr('x', 0).attr('y', 0)
      .attr('width', function (d) { return Math.max(0, d.x1 - d.x0); })
      .attr('height', function (d) { return Math.max(0, d.y1 - d.y0); });

    all.transition().duration(dur).ease(d3.easeCubicInOut)
      .attr('transform', function (d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; })
      .style('opacity', 1);

    all.each(function (d) {
      var w = d.x1 - d.x0, h = d.y1 - d.y0;
      var g = d3.select(this);
      var showName = w > 46 && h > 19;
      var showVal = w > 62 && h > 34;
      var name = (d.data.level === 'residual' && w < 120) ? '市辖区' : d.data.name;
      var maxChars = Math.max(2, Math.floor((w - 6) / 12));
      if (name.length > maxChars) name = name.slice(0, maxChars) + '…';

      var fill = colorFor(val(d.data), d.data.level);
      var tc = textColor(fill);
      g.select('text.n')
        .attr('x', 4).attr('y', 15)
        .style('fill', tc)
        .attr('display', showName ? null : 'none')
        .text(name);
      g.select('text.v')
        .attr('x', 4).attr('y', 28)
        .style('fill', tc === '#ffffff' ? 'rgba(255,255,255,.8)' : 'rgba(27,36,48,.62)')
        .attr('display', showVal ? null : 'none')
        .text(fmt(val(d.data), 1) + ' ' + unit());
    });

    updateBreadcrumb(focus);
    updateLegend(childLevelOf(focus));
  }

  /* ================================================================ 图例 */
  function updateLegend(level) {
    var s = SCALES[level] && SCALES[level][state.metric];
    var el = document.getElementById('legend');
    if (!s) { el.innerHTML = ''; return; }

    var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (t) { return s.max * t * t; });
    var grad = state.metric === 'gdp'
      ? 'linear-gradient(90deg,#ffffff,#0000ff)'
      : 'linear-gradient(90deg,#ffffff,#ff0000)';

    el.innerHTML =
      '<div class="cap">' + (state.metric === 'gdp' ? 'GDP' : '户籍人口') +
      ' · ' + ({ province: '省级', city: '市级', county: '县级' }[level] || '') +
      '（' + unit() + '）' + (level === 'county' ? ' · 半透明=市辖区合计' : '') + '</div>' +
      '<div class="bar" style="background:' + grad + '"></div>' +
      '<div class="ticks">' + ticks.map(function (v) {
        return '<span>' + d3.format(',.0f')(v) + '</span>';
      }).join('') + '</div>';
  }

  /* ================================================================ 详情 */
  var LEVEL_NAME = {
    province: '省级', city: '地级市', county: '县级',
    district: '市辖区', residual: '市辖区', nodata: '数据暂缺', root: '全国'
  };

  function renderDetail(node) {
    var el = document.getElementById('detail');
    if (!node) {
      el.innerHTML = '<h2>选中单位</h2><p class="muted">在地图上双击一个单位，或在树形图中点击叶子节点。</p>';
      return;
    }

    if (node.level === 'nodata') {
      el.innerHTML = '<h2>数据暂缺</h2>' +
        '<div class="detail-head"><strong>' + node.name + '</strong></div>' +
        '<p class="muted">该地区暂未纳入统计数据集（港澳台数据暂缺）。</p>';
      return;
    }

    var g = node.gdp || 0;
    var p = node.pop || 0;
    var share = node.share || { p1: 0, p2: 0, p3: 0 };
    var pc = (g > 0 && p > 0) ? (g / p * 10000) : null;
    var sub = node.level === 'residual'
      ? ('合计' + ((node.districts && node.districts.length) ? '（含 ' + node.districts.length + ' 个区）' : ''))
      : node.level === 'district' ? '市辖区' : '';
    var districtLine = (node.districts && node.districts.length)
      ? '<p class="districts">包含：' + node.districts.join('、') + '</p>' : '';

    el.innerHTML =
      '<h2>' + (LEVEL_NAME[node.level] || '') + '</h2>' +
      '<div class="detail-head"><strong>' + node.name + '</strong>' +
      '<span>' + sub + '</span></div>' +
      '<div class="kv"><span class="k">GDP</span><span class="v">' + fmtGdp(g) + '</span></div>' +
      '<div class="kv"><span class="k">户籍人口</span><span class="v">' + fmtPop(p) + '</span></div>' +
      '<div class="kv"><span class="k">人均 GDP</span><span class="v">' +
      (pc == null ? '—' : d3.format(',.0f')(pc) + ' 元') + '</span></div>' +
      '<div class="shares">' +
      shareRow('第一产业', share.p1, '#6aa84f') +
      shareRow('第二产业', share.p2, '#2f6feb') +
      shareRow('第三产业', share.p3, '#e0913a') +
      '</div>' + districtLine;
  }

  function shareRow(label, pct, color) {
    return '<div class="row"><span class="tag">' + label + '</span>' +
      '<span class="track"><span class="fill" style="width:' + Math.max(0, Math.min(100, pct)) +
      '%;background:' + color + '"></span></span>' +
      '<span class="pct">' + (pct || 0).toFixed(1) + '%</span></div>';
  }

  function selectNode(node) {
    state.selected = node;
    renderDetail(node);
    if (state.view === 'map') paintMap();
    else {
      treeG.selectAll('g.tm-node').classed('sel', function (d) { return d.data.__id === node.__id; });
    }
  }

  /* ================================================================ 面包屑 */
  function updateBreadcrumb(focus) {
    var el = document.getElementById('crumb');
    var path = focus.__path || [TREE];
    el.hidden = false;
    var html = '';
    path.forEach(function (n, i) {
      if (i) html += '<span class="sep">/</span>';
      if (i === path.length - 1) html += '<span>' + (n === TREE ? '全国' : n.name) + '</span>';
      else html += '<button data-i="' + i + '">' + (n === TREE ? '全国' : n.name) + '</button>';
    });
    el.innerHTML = html;
    el.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.focus = path[+b.dataset.i] === TREE ? null : path[+b.dataset.i];
        renderTree(true);
      });
    });
  }

  /* ================================================================ 右键菜单 */
  var ctxEl = document.getElementById('ctx');

  function openMenu(event, node) {
    ctxEl.hidden = false;
    ctxEl.style.left = Math.min(event.clientX + 4, window.innerWidth - 170) + 'px';
    ctxEl.style.top = Math.min(event.clientY + 4, window.innerHeight - 60) + 'px';
    ctxEl.innerHTML = '<button id="goTree">前往树形图</button>';
    document.getElementById('goTree').addEventListener('click', function () {
      ctxEl.hidden = true;
      goTree(node);
    });
  }

  function goTree(node) {
    var path = node.__path || [];
    state.focus = path.length > 1 ? path[path.length - 2] : null;
    if (state.focus === TREE) state.focus = null;
    switchView('tree');
    selectNode(node);
  }

    function goMap(node) {
        if (!node) return;

        var mapLevel = node.level === 'province' ? 'province'
            : node.level === 'city' ? 'city'
                : 'county';

        state.level = mapLevel;

        switchView('map');
        selectNode(node);

        if (!svgMap || !zoom || !GEO) return;

        var features = [];

        if (node.level === 'province') {
            features = GEO.province.features.filter(function (f) {
                return String(f.properties['省代码']) === String(node.code);
            });
        } else if (node.level === 'city') {
            features = GEO.city.features.filter(function (f) {
                return String(f.properties['市代码']) === String(node.code);
            });
        } else if (node.level === 'county' || node.level === 'district') {
            features = GEO.county.features.filter(function (f) {
                return String(f.properties['县代码']) === String(node.code);
            });
        } else if (node.level === 'residual') {
            features = GEO.county.features.filter(function (f) {
                var countyCode = String(f.properties['县代码']);
                return String(f.properties['市代码']) === String(node.code)
                    && !byCode[countyCode];
            });
        }

        if (!features.length) {
            console.warn('未找到对应地图区域：', node.name, node.code);
            return;
        }

        var bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];

        features.forEach(function (f) {
            var b = geoPath.bounds(f);
            bounds[0][0] = Math.min(bounds[0][0], b[0][0]);
            bounds[0][1] = Math.min(bounds[0][1], b[0][1]);
            bounds[1][0] = Math.max(bounds[1][0], b[1][0]);
            bounds[1][1] = Math.max(bounds[1][1], b[1][1]);
        });

        var width = bounds[1][0] - bounds[0][0];
        var height = bounds[1][1] - bounds[0][1];

        if (width <= 0 || height <= 0) return;

        var centerX = (bounds[0][0] + bounds[1][0]) / 2;
        var centerY = (bounds[0][1] + bounds[1][1]) / 2;


        var k = Math.min(
            (mapW - 100) / width,
            (mapH - 100) / height
        );

        if (node.level === 'province') {
            k = Math.max(1, Math.min(1.8, k));
        } else if (node.level === 'city') {
            k = Math.max(2.1, Math.min(6.4, k));
        } else {
            k = Math.max(6.6, Math.min(44, k));
        }

        var x = mapW / 2 - centerX * k;
        var y = mapH / 2 - centerY * k;

        state.animating = true;
        hideTip();

        svgMap.transition('locate')
            .duration(650)
            .ease(d3.easeCubicOut)
            .call(
                zoom.transform,
                d3.zoomIdentity.translate(x, y).scale(k)
            );
    }
  /* ================================================================ 视图切换 */
  function setSwitch(group, value) {
    var sel = group === 'view' ? '#viewSwitch button' : '#metricSwitch button';
    var attr = group === 'view' ? 'data-view' : 'data-metric';
    document.querySelectorAll(sel).forEach(function (b) {
      b.classList.toggle('on', b.getAttribute(attr) === value);
    });
  }

  var mapEl = document.getElementById('mapView');
  var treeEl = document.getElementById('treeView');

  function switchView(viewName, animate) {
    var changing = viewName !== state.view;
    state.view = viewName;

    if (viewName === 'tree') {
      if (!svgTree) initTree();
      renderTree(animate !== false);
    } else {
      if (!svgMap) initMap();
      else paintMap();
    }

    mapEl.classList.toggle('is-hidden', viewName !== 'map');
    treeEl.classList.toggle('is-hidden', viewName !== 'tree');
    document.getElementById('levelTip').hidden = viewName !== 'map';
    document.getElementById('crumb').hidden = viewName !== 'tree';
    document.getElementById('hint').textContent = viewName === 'map'
      ? '滚轮缩放 · 左键拖动 · 双击选中 · 右键菜单'
      : '点击下钻 · 点击叶子选中 · 面包屑返回';
    setSwitch('view', viewName);
    hideTip();
  }

  function switchMetric(metric) {
    state.metric = metric;
    if (state.view === 'map') paintMap();
    else renderTree(true);
    if (state.selected) renderDetail(state.selected);
  }

  /* ================================================================ 初始化 */
  document.querySelectorAll('#viewSwitch button').forEach(function (b) {
    b.addEventListener('click', function () { if (b.dataset.view !== state.view) switchView(b.dataset.view); });
  });
  document.querySelectorAll('#metricSwitch button').forEach(function (b) {
    b.addEventListener('click', function () {
      switchMetric(b.dataset.metric);
      setSwitch('metric', b.dataset.metric);
    });
  });

  document.addEventListener('click', function () { ctxEl.hidden = true; });
  document.addEventListener('contextmenu', function (e) {
    if (!e.target.closest || !e.target.closest('#mapView')) ctxEl.hidden = true;
  });

  window.addEventListener('resize', function () {
    clearTimeout(window.__rs);
    window.__rs = setTimeout(function () {
      if (state.view === 'map') initMap();
      else { initTree(); renderTree(false); }
    }, 160);
  });

  // 启动
  initMap();
  treeEl.classList.add('is-hidden');
  switchView('map', false);
  renderDetail(null);
})();
