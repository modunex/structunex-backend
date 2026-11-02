const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveType, cleanFileName, contentMatches } = require("./communityFiles");

test("admite solo la lista permitida", () => {
  for (const name of ["a.png", "A.JPG", "b.jpeg", "c.webp", "d.pdf", "e.docx", "f.xlsx", "g.csv", "h.txt", "i.dwg", "j.dxf"]) {
    assert.ok(resolveType(name), name);
  }
  for (const name of ["a.exe", "a.js", "a.html", "a.svg", "a.zip", "a.docm", "a.xlsm", "a.bat", "a.sh", "a", ".png.exe", "a.pdf.exe"]) {
    assert.equal(resolveType(name), null, name);
  }
});

test("el tipo lo fija el servidor por extensión", () => {
  assert.equal(resolveType("x.PDF").mime, "application/pdf");
  assert.equal(resolveType("x.png").kind, "image");
  assert.equal(resolveType("x.pdf").kind, "file");
});

test("limpia rutas y caracteres de control del nombre", () => {
  assert.equal(cleanFileName("../../etc/passwd.txt"), "passwd.txt");
  assert.equal(cleanFileName("C:\\tmp\\plano.dwg"), "plano.dwg");
  assert.equal(cleanFileName("a\u0000b\r\n.pdf"), "ab.pdf");
});

test("el contenido debe coincidir con la extensión", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(contentMatches("png", png), true);
  assert.equal(contentMatches("jpg", png), false);
  assert.equal(contentMatches("pdf", Buffer.from("%PDF-1.7\n")), true);
  assert.equal(contentMatches("pdf", Buffer.from("<html>")), false);
  assert.equal(contentMatches("docx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0])), true);
  assert.equal(contentMatches("xlsx", Buffer.from("MZ\x90\x00")), false);
  assert.equal(contentMatches("dwg", Buffer.from("AC1032\0\0")), true);
  assert.equal(contentMatches("dwg", Buffer.from("XXXXXX")), false);
  assert.equal(contentMatches("webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), true);
});

test("un texto no puede contener HTML, SVG ni binario", () => {
  assert.equal(contentMatches("txt", Buffer.from("hola, mundo")), true);
  assert.equal(contentMatches("csv", Buffer.from("a,b\n1,2\n")), true);
  assert.equal(contentMatches("dxf", Buffer.from("0\nSECTION\n")), true);
  for (const body of ["<!DOCTYPE html>", "  <html>", "<script>alert(1)</script>", "<svg onload=x>", "#!/bin/sh"]) {
    assert.equal(contentMatches("txt", Buffer.from(body)), false, body);
  }
  assert.equal(contentMatches("txt", Buffer.from([0x61, 0x00, 0x62])), false);
});
