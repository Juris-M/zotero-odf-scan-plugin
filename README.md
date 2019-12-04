# Building odf-scan

The build requires python 3.7 and node 8+. Before running build, you must prepare the build environment once by running

```
$ pip3 install -r requirements.txt
$ npm install
```

After this, `build.py` rebuilds the XPI. Without parameters it just grabs the sources,
creates the install.rdf and zips it up. If you pass --release, it will
also update update.rdf

The build (ab)uses node solely because npm has good built-in facilities
for version management. `npm version` manages versions nicely and also
checks you're not bumping versions while your working dir is dirty. It
also stores the version number in package.json, where build.py picks
it up.

`npm version` will automatically run `build.py` after bumping.

