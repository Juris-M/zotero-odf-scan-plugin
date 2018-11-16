#!/usr/bin/env python3

import zipfile
import glob
import argparse
import os
import json
from lxml import etree

class Builder:
  def __init__(self):
    parser = argparse.ArgumentParser()
    parser.add_argument("--beta", action='store_true', help="build beta XPI")
    parser.add_argument("--release", action='store_true', help="update update.rdf")
    args = parser.parse_args()
    self.beta = args.beta
    self.release = args.release

    if self.beta and self.release: raise ValueError('Cannot release a beta')

    with open('package.json') as f:
      self.package = json.load(f)
    self.version = self.package['version']

    self.xpi = f'zotero-odf-scan-v{self.version}{"-beta" if self.beta else ""}.xpi'

    self.install_rdf()
    self.about_dtd()
    if self.release: self.update_rdf()
    self.build()

  def namespaces(self, doc):
    namespaces = {}
    for ns in doc.xpath('//namespace::*'):
      if ns[0]: # Removes the None namespace, neither needed nor supported.
        namespaces[ns[0]] = ns[1]
    return namespaces

  def install_rdf(self):
    rdf = etree.parse('install.rdf')
    rdf.find('.//em:version', namespaces=self.namespaces(rdf)).text = self.version
    with open('install.rdf', 'wb') as f:
      f.write(etree.tostring(rdf, pretty_print=True))

  def about_dtd(self):
    with open('chrome/locale/en-US/about.dtd') as f:
      dtd = etree.DTD(f)

    with open('chrome/locale/en-US/about.dtd', 'w') as f:
      print(f'<!ENTITY odfscan.version "{self.version}">', file=f)

      for entity in list(dtd.entities()):
        if entity.name == 'odfscan.version': continue
        print(f'<!ENTITY {entity.name} "{entity.content}">', file=f)

  def update_rdf(self):
    rdf = etree.parse('docs/update.rdf')
    namespaces = self.namespaces(rdf)
    rdf.find('.//em:version', namespaces=namespaces).text = self.version
    rdf.find('.//em:updateLink', namespaces=namespaces).text = f'https://github.com/Juris-M/zotero-odf-scan-plugin/releases/download/v{self.version}/zotero-odf-scan-v{self.version}.xpi'
    with open('docs/update.rdf', 'wb') as f:
      f.write(etree.tostring(rdf, pretty_print=True))

  def build(self):
    for xpi in glob.glob('*.xpi'):
      os.remove(xpi)
    with zipfile.ZipFile(self.xpi, 'w', zipfile.ZIP_DEFLATED) as xpi:
      for file in ['chrome.manifest', 'bootstrap.js', 'install.rdf'] + glob.glob('resource/**/*') + glob.glob('chrome/**/*'):
        xpi.write(file)

Builder()
