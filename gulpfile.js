const fs = require("fs")

const { series, src } = require('gulp')
const clean = require('gulp-clean')
const exec = require('child_process').execSync
const axios = require('axios');
const cheerio = require('cheerio');
const download = require('download');
const admZip = require('adm-zip');
const _ = require('lodash')
const iconv = require('iconv-lite')

const SRC = 'src/'
const DIST = 'dist/'

const shpPath = {
  ctprvn: {
    source: 'src/CTPRVN/TL_SCCO_CTPRVN.shp',
    convert: 'src/CTPRVN/TL_SCCO_CTPRVN_CONVERT.shp',
    json: 'dist/ctprvn.json'
  },
  sig: {
    source: 'src/SIG/TL_SCCO_SIG.shp',
    convert: 'src/SIG/TL_SCCO_SIG_CONVERT.shp',
    json: 'dist/sig.json'
  },
  emd: {
    source: 'src/EMD/TL_SCCO_EMD.shp',
    convert: 'src/EMD/TL_SCCO_EMD_CONVERT.shp',
    json: 'dist/emd.json'
  }
}

const cleanAll = () => src(['download/*.zip', 'dist/**/*.json', 'src/**/*.*']).pipe(clean())

const decompress = (filePath) => {
  const zip = new admZip(filePath)
  const zipEntries = zip.getEntries();
  const dirPath = SRC + filePath.split('_')[0].split('/')[1]

  // Create SRC Directory
  if (!fs.existsSync(SRC)) {
    fs.mkdirSync(SRC);
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  // Unzip Files
  zipEntries.forEach(zipEntry => {
    fs.writeFileSync(`${dirPath}/${zipEntry.entryName}`, zipEntry.getData());
  });
}

const downloadMapZip = async (done) => {
  const getMapSite = async () => {
    try {
      return await axios.get(
        `http://www.gisdeveloper.co.kr/?p=2332`
      );
    } catch (error) {
      console.error(error);
    }
  };

  return getMapSite()
    .then(html => {
      let filePathList = []
      const $ = cheerio.load(html.data);

      $('div.entry-content').children('table').each(function (i, elem) {
        filePathList[i] = $(this).first().find('a').first().attr('href')
      })

      Promise.all(filePathList.map(x => download(x, 'download'))).then(() => {
        console.log('Files downloaded!');
      }).then(() => {
        const fileNameList = []

        fs.readdir('download/', (err, files) => {
          files.forEach(file => {
            fileNameList.push('download/' + file)
          });
          fileNameList.map(path => decompress(path))
        });
      });
    })
}

const mapshaperTask = (done) => {
  // Create DIST Directory
  if (!fs.existsSync(DIST)) {
    fs.mkdirSync(DIST);
  }

  mapshaper('ctprvn')
  mapshaper('sig')
  mapshaper('emd')
  done()
}

const ogr2ogrTask = (done) => {
  ogr2ogr('ctprvn')
  ogr2ogr('sig')
  ogr2ogr('emd')
  done()
}

// 시군구 & 동 geojson 생성
const split = (done) => {
  splitGeojson('sig')
  splitGeojson('emd')
  done()
}

const mapshaper = (key) => {
  const mapshaperCommand = `mapshaper -i ${shpPath[key].source} encoding=euc-kr -simplify weighted 0.5% -o format=shapefile ${shpPath[key].convert}`

  exec(mapshaperCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`)
      return
    }

    console.log(stdout)
    console.log(stderr)

    console.log('=> convert size')
    console.log('%s : %d bytes', shpPath[key].source, fs.statSync(shpPath[key].source).size)
    console.log('%s : %d bytes', shpPath[key].convert, fs.statSync(shpPath[key].convert).size)
    console.log('=>')
  })
}

const ogr2ogr = (key) => {
  const command = `ogr2ogr -f GeoJSON ${shpPath[key].json} ${shpPath[key].convert}`

  exec(command, function (error, stdout, stderr) {
    if (error) {
      console.error(`exec error: ${error}`)
      return
    }

    console.log(stdout)
    console.log(stderr)

    console.log('=> convert json size')
    console.log('%s : %d bytes', shpPath[key].json, fs.statSync(shpPath[key].json).size)
    console.log('=>')
  })
}

const cleanSplit = () => src(['dist/sig/*.json', 'dist/emd/*.json']).pipe(clean())

function splitGeojson(type) {
  console.log("\n *Split geoJSON START* \n")
  // 시군구 데이터 시도별로 자르기
  const fileName = shpPath[type].json
  const contents = iconv.decode(fs.readFileSync(fileName), 'utf-8')
  const features = {}
  const jsonContent = JSON.parse(contents)
  const typePath = DIST + type

  if (!fs.existsSync(typePath)) {
    fs.mkdirSync(typePath);
  }

  for (let key in jsonContent.features) {
    const feature = jsonContent.features[key]
    let subKey

    if (type == 'sig') {
      subKey = feature.properties.SIG_CD.substr(0, 2)
    } else if (type == 'emd') {
      subKey = feature.properties.EMD_CD.substr(0, 5)
    }

    if (features.hasOwnProperty(subKey)) {
      features[subKey].push(feature)
    } else {
      features[subKey] = []
      features[subKey].push(feature)
    }
  }

  for (let key in features) {
    const jsonStr = {
      "type": "FeatureCollection",
      "features": features[key]
    }
    fs.writeFileSync(`${typePath}/${key}.json`, JSON.stringify(jsonStr))
  }
  console.log("\n *Split geoJSON END* \n")
}

// Default task to convert
// Gulp 4.0부터는 Task함수를 사용하기보다 일반 기명함수로 Task를 만들고, CommonJS 모듈 형식으로 내보내기를 권장한다.
// gulp.task('default', ['convert'])
exports.convert = series(mapshaperTask, ogr2ogrTask, cleanSplit, split)
exports.default = series(cleanAll, downloadMapZip)