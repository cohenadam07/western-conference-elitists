#!/bin/zsh
# Recalculate an .xlsx headlessly in LibreOffice (the template was authored in LibreOffice Calc) and save the computed
# values. Numbers.app was tried first and cannot evaluate this workbook (it blanks VALUE("0:"&F2) and the roster lookups).
# Usage: tools/live-lineups/recalc.sh <in.xlsx> <outdir>
SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice
prof=$(mktemp -d)
# force "always recalculate on load" for OOXML files
mkdir -p $prof/user && cat > $prof/user/registrymodifications.xcu <<XCU
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
XCU
$SOFFICE -env:UserInstallation=file://$prof --headless --calc --convert-to xlsx:"Calc MS Excel 2007 XML" --outdir "$2" "$1" >/dev/null 2>&1
rm -rf $prof
