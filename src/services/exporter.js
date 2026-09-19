'use strict';
const ExcelJS = require('exceljs');
const { thaiDate, money } = require('../utils/thai');

const BRAND = 'FF4F46E5';
const BRAND_LIGHT = 'FFEEF2FF';

/**
 * สร้างไฟล์ Excel จากนิยามตาราง
 * @param {{title:string, subtitle?:string, meta?:string[], sheets:Array<{
 *   name:string, columns:Array<{header:string,key:string,width?:number,type?:'money'|'number'|'date'|'text'}>,
 *   rows:Array<Object>, totals?:Object
 * }>}} spec
 */
async function buildWorkbook(spec) {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.creator || 'ระบบแจ้งชำระเงิน';
  wb.created = new Date();

  for (const sheet of spec.sheets) {
    const ws = wb.addWorksheet(String(sheet.name || 'รายงาน').slice(0, 31), {
      pageSetup: { paperSize: 9, orientation: sheet.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 0 }],
    });
    const colCount = sheet.columns.length;

    /* ---- หัวรายงาน ---- */
    let r = 1;
    const addBanner = (text, opts = {}) => {
      ws.mergeCells(r, 1, r, colCount);
      const cell = ws.getCell(r, 1);
      cell.value = text;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { bold: opts.bold !== false, size: opts.size || 14, color: { argb: opts.color || 'FF0F172A' } };
      ws.getRow(r).height = opts.height || 22;
      r++;
    };

    addBanner(spec.title, { size: 16 });
    if (spec.subtitle) addBanner(spec.subtitle, { size: 12, bold: false, color: 'FF475569' });
    if (sheet.subtitle) addBanner(sheet.subtitle, { size: 12, bold: false, color: 'FF475569' });
    for (const m of spec.meta || []) addBanner(m, { size: 10, bold: false, color: 'FF64748B', height: 16 });
    r++; // เว้นบรรทัด

    /* ---- หัวตาราง ---- */
    const headerRow = ws.getRow(r);
    sheet.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow.height = 26;
    const headerIndex = r;
    r++;

    /* ---- ข้อมูล ---- */
    sheet.rows.forEach((row, ri) => {
      const xr = ws.getRow(r);
      sheet.columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1);
        const raw = row[c.key];
        if (c.type === 'money' || c.type === 'number') {
          cell.value = raw === null || raw === undefined || raw === '' ? null : Number(raw);
          cell.numFmt = c.type === 'money' ? '#,##0.00' : '#,##0';
          cell.alignment = { horizontal: 'right' };
        } else if (c.type === 'date') {
          cell.value = raw ? thaiDate(raw) : '';
          cell.alignment = { horizontal: 'center' };
        } else {
          cell.value = raw === null || raw === undefined ? '' : String(raw);
          cell.alignment = { horizontal: c.align || 'left', vertical: 'middle', wrapText: !!c.wrap };
        }
        cell.border = { top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' } };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
      r++;
    });

    /* ---- แถวสรุป ---- */
    if (sheet.totals) {
      const tr = ws.getRow(r);
      sheet.columns.forEach((c, i) => {
        const cell = tr.getCell(i + 1);
        if (i === 0) cell.value = sheet.totals.__label || 'รวมทั้งสิ้น';
        else if (sheet.totals[c.key] !== undefined) {
          cell.value = Number(sheet.totals[c.key]);
          cell.numFmt = c.type === 'money' ? '#,##0.00' : '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_LIGHT } };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
      });
      tr.height = 22;
      r++;
    }

    sheet.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 18; });
    ws.autoFilter = { from: { row: headerIndex, column: 1 }, to: { row: headerIndex, column: colCount } };
    ws.views = [{ state: 'frozen', ySplit: headerIndex }];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** สร้างไฟล์ CSV (UTF-8 พร้อม BOM ให้ Excel ภาษาไทยเปิดได้ถูกต้อง) */
function buildCsv(columns, rows, { title = '', meta = [] } = {}) {
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  if (title) lines.push(esc(title));
  for (const m of meta) lines.push(esc(m));
  if (title || meta.length) lines.push('');
  lines.push(columns.map((c) => esc(c.header)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => {
      const val = row[c.key];
      if (c.type === 'money') return esc(val === null || val === undefined || val === '' ? '' : money(val));
      if (c.type === 'date') return esc(val ? thaiDate(val) : '');
      return esc(val);
    }).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

/** ส่งไฟล์ออกทาง HTTP พร้อมตั้งชื่อไฟล์ให้รองรับภาษาไทย */
function sendFile(res, buffer, filename, mime) {
  res.setHeader('Content-Type', mime);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(buffer);
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_CSV = 'text/csv; charset=utf-8';

module.exports = { buildWorkbook, buildCsv, sendFile, MIME_XLSX, MIME_CSV };
