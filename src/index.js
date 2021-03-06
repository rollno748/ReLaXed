#!/usr/bin/env node
const colors = require('colors')
const program = require('commander')
const chokidar = require('chokidar')
const puppeteer = require('puppeteer')
const { performance } = require('perf_hooks')
const path = require('path')
const fs = require('fs')
const converters = require('./converters.js')

var input, output

const version = require('../package.json').version

program
  .version(version)
  .usage('<input> [output] [options]')
  .arguments('<input> [output] [options]')
  .option('--no-sandbox', 'disable puppeteer sandboxing')
  .option('-w, --watch <locations>', 'Watch other locations', [])
  .option('-t, --temp [location]', 'Directory for temp file')
  .option('--build-once', 'Build only, do not watch')
  .action(function (inp, out) {
    input = inp
    output = out
  })

program.parse(process.argv)

if (!input) {
  console.error('ReLaXed error: no input file specified'.red);
  process.exit(1)
}

const inputPath = path.resolve(input)
const inputDir = path.resolve(inputPath, '..')
const inputFilenameNoExt = path.basename(input, path.extname(input))

if (!output) {
  output = path.join(inputDir, inputFilenameNoExt + '.pdf')
}

const outputPath = path.resolve(output)

var tempDir
if (program.temp) {
  var validTempPath = fs.existsSync(program.temp) && fs.statSync(program.temp).isDirectory()
  if (validTempPath) {
    tempDir = path.resolve(program.temp)
  } else {
    console.error(('ReLaXed error: Could not find specified --temp directory: ' +
                   program.temp).red)
    process.exit(1)
  }
} else {
  tempDir = inputDir
}

const tempHTMLPath = path.join(tempDir, inputFilenameNoExt + '_temp.htm')

let watchLocations = [inputDir]
if (program.watch) {
  watchLocations = watchLocations.concat(program.watch)
}

const puppeteerConfig = {
  headless: true,
  args: program.sandbox ? ['--no-sandbox'] : []
}

async function main () {
  console.log('Launching ReLaXed...'.magenta.bold)
  const browser = await puppeteer.launch(puppeteerConfig);
  const page = await browser.newPage()
  // await page.pdf()
  page.on('pageerror', function (err) {
    console.log('Page error: ' + err.toString())
  }).on('error', function (err) {
    console.log('Error: ' + err.toString())
  })

  if (program.buildOnce) {
    convert(page)
  } else {
    watch(page)
  }
}

/**
 * Perform one time build on master document
 *
 * @param {puppeteer.Page} page
 */
async function convert (page) {
  console.log('Building the document...'.bold.magenta)
  await converters.masterDocumentToPDF(inputPath, page, tempHTMLPath, outputPath).catch(e => {
    console.log(e.toString())
    process.exit(1)
  })
  console.log('... done !'.bold.magenta)
  process.exit(0)
}

/**
 * Watch `watchLocations` paths for changes and continuously rebuild
 *
 * @param {puppeteer.Page} page
 */

function watch (page) {
  console.log(`\nNow waiting for changes in ${input.underline} and its directory`.magenta)
  var globals = {
    busy: false
  }
  chokidar.watch(watchLocations, {
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 100
    }
  }).on('change', (filepath) => {

    if (!(['.pug', '.md', '.html', '.css', '.scss', '.svg', '.mermaid',
           '.chart.js', '.png', '.flowchart', '.flowchart.json',
           '.vegalite.json', '.table.csv', 'htable.csv'].some(ext => filepath.endsWith(ext)))) {
      return
    }
    var shortFileName = filepath.replace(inputDir, '')
    if (globals.busy) {
      console.log(`( detected change in ${shortFileName}, but too busy right now )`.yellow)
      return
    }
    console.log(`\nProcessing detected change in ${shortFileName}...`.magenta.bold)
    globals.busy = true

    var t0 = performance.now()
    var taskPromise = null
    if (filepath.endsWith('.chart.js')) {
      taskPromise = converters.chartjsToPNG(filepath, page)
    } else if (filepath.endsWith('.mermaid')) {
      taskPromise = converters.mermaidToSvg(filepath, page)
    } else if (filepath.endsWith('.flowchart')) {
      taskPromise = converters.flowchartToSvg(filepath, page)
    } else if (filepath.endsWith('.flowchart.json')) {
      var flowchartFile = filepath.substr(0, filepath.length - 5)
      taskPromise = converters.flowchartToSvg(flowchartFile, page)
    } else if (filepath.endsWith('.vegalite.json')) {
      taskPromise = converters.vegaliteToSvg(filepath, page)
    } else if (['.table.csv', '.htable.csv'].some(ext => filepath.endsWith(ext))) {
      converters.tableToPug(filepath)
    } else if (filepath.endsWith('.o.svg')) {
      taskPromise = converters.svgToOptimizedSvg(filepath)
    } else if (['.pug', '.md', '.html', '.css', '.scss', '.svg', '.png'].some(ext => filepath.endsWith(ext))) {
      taskPromise = converters.masterDocumentToPDF(inputPath, page, tempHTMLPath, outputPath)
    }
    if (taskPromise) {
      taskPromise.then(function () {
        var duration = ((performance.now() - t0) / 1000).toFixed(2)
        console.log(`... Done in ${duration}s`.magenta)
        globals.busy = false
      })
    } else {
      globals.busy = false
    }


  })
}

main()
