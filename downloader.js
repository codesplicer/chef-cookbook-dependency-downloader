/*
 * Chef Cookbook Dependency Downloader
 *
 * Copyright (c) 2013 Vik Bhatti
 * Licensed under the MIT license.
 */

// Dependencies
var exec = require('child_process').exec,
    _ = require('underscore'),
    url = require('url'),
    fs = require('fs'),
    lazy = require('lazy'),
    zlib = require('zlib'),
    path = require('path'),
    util = require('util'),
    reader = require('buffered-reader'),
    task_runner = require('./task-runner'),
    DataReader = reader.DataReader,
    request = require('request');

var argv = require('optimist').usage('Usage: $0 -c [/path/to/target/cookbook]').demand('c').alias('c', 'cookbook').describe('c', 'Path to target cookbook').argv;

// Settings
var API_BASE_URL = 'https://cookbooks.opscode.com/api/v1/';
var COOKBOOK_ENDPOINT = 'cookbooks/';
var DOWNLOAD_DIR = __dirname + '/downloaded-cookbooks/';

// State (its a global yes, but this is a one off script so its ok)
var COOKBOOKS_MAP = {};


/*******************************************************************************
 * existsSync()
 *******************************************************************************
 * Hacky wrapper for existsSync, so it works on old and new node version
 *
 * Inputs:
 *   filePath:
 */
function existsSync(filePath)
{
  var fn = fs.existsSync || path.existsSync;
  return fn(filePath);
}


/*******************************************************************************
 * parseJSON()
 *******************************************************************************
 * Wrapper for JSON.parse, traps exceptions.
 *
 * Inputs:
 *   jsonData:
 */
function parseJSON(jsonData)
{
  if (!jsonData)
    return null;

  try
  {
    return JSON.parse(jsonData);
  }
  catch (ex)
  {
    console.log('parseJSON: error parsing jsonData: ', jsonData);
    return null;
  }
}

/*******************************************************************************
 * GetUrl
 *******************************************************************************
 * Generic wrapper around request.
 *
 * Inputs:
 *   url:
 *
 *   callback():
 */
function GetUrl(url, callback)
{
  request(url, function(err, res, body)
  {
    if (err || res.statusCode !== 200)
      return callback({ err: err, statusCode: res.statusCode } );

    var data = parseJSON(body);
    if(!data)
        return callback('GetUrl: Could not parse JSON body from request', null);

    return callback(null, data);
  });
}


/*******************************************************************************
 * ParseMetadataRuby
 *******************************************************************************
 * Parse the actual metadata.rb file as we didn't have the json equivalent in
 * the cookbooks we download from community repo
 *
 * Inputs:
 *   filePath:
 *
 *   callback():
 */
function ParseMetadataRuby(filePath, callback)
{
  var depends = {};
  var regex = "depends";

  if(!existsSync(filePath))
    return callback(filePath + ' does not exist');

  var fileStream = fs.createReadStream(filePath);

  fileStream.on('error', function(err){
     console.log(err);
  });

  var lazyReader = new lazy(fileStream);
  lazyReader.lines.forEach(function(lineObj)
  {
    var line = lineObj.toString();

    if (line.search(regex) != -1)
    {
      // Add key to HashMap
      var name = ExtractDependency(line);
      depends[name] = '';
    }
  } ).join(function()
  {
    console.log("Finished parsing file");
    return callback(null, depends);
  } );
}


/*******************************************************************************
 * ExtractDependency
 *******************************************************************************
 * Extracts cookbook name from depends line.
 *
 * Inputs:
 *   line:
 */
function ExtractDependency(line)
{
  // Split line and do some string cleanup and trimming
  var result = line.split("\s");
  var dependencyName = result[1].replace(/"/g, "");
  dependencyName = dependencyName.trim();
  console.log('Found Dependency: ' + dependencyName);

  return dependencyName;
}

/*******************************************************************************
 * ParseMetadataJson
 *******************************************************************************
 * Parse the metadata.json file
 *
 * Inputs:
 *   filePath:
 *
 *   callback():
 */
function ParseMetadataJson(filePath, callback)
{
  var depends = {};
  var regex = "depends";

  if(!existsSync(filePath))
    return callback(filePath + ' does not exist');

  // Extract dependencies and add to hashmap
  var json = fs.readFileSync(filePath);
  var data = parseJSON(json);
  if(!data)
      return callback('ParseMetadataJson: Could not parse JSON body from request', null);

  _.each(data['dependencies'], function(value, name){
     depends[name] = '';
  });

  return callback(null, depends);
}


/*******************************************************************************
 * GetCookbookTarballUrl
 *******************************************************************************
 * Follows the crappy opscode API breadcrumb trail until we get the real tarball
 * for the cookbook.
 *
 * Inputs:
 *   cookbookName:
 *
 *   callback:
 */
function GetCookbookTarballUrl(cookbookName, callback)
{
  // Make a call to the OpsCode API and find the download URL for specified cookbook
  var endpoint = API_BASE_URL + COOKBOOK_ENDPOINT + cookbookName;

  GetUrl(endpoint, function(err, data)
  {
    if (err)
      return callback(err, null);

    var latestUrl = data['latest_version'];

    // Now make another call to get the tarball URL
    GetUrl(latestUrl, function(err, data)
    {
      if (err)
        return callback(err, null);

      var downloadUrl = data['file'];
      return callback(null, downloadUrl);
    });
  });
}


/*******************************************************************************
 * DownloadCookbookTarball
 *******************************************************************************
 * Download the tarball and unpack it into DOWNLOAD_DIR.
 *
 * Inputs:
 *   cookbookDownloadUrl:
 *   cookbookName:
 *
 *   callback:
 */
function DownloadCookbookTarball(cookbookDownloadUrl, cookbookName, callback)
{
  var filename = cookbookName + '.tgz';
  var downloadFile = path.join(DOWNLOAD_DIR, filename);

  // Make sure DOWNLOAD_DIR exists
  if (!existsSync(path.resolve(DOWNLOAD_DIR)))
  {
    // Create the directory
    fs.mkdir(DOWNLOAD_DIR);
  }

  // Have to fork a child process as doing it via streams was throwing some
  // async timing issues! 
  var commands = [
    "cd " + DOWNLOAD_DIR,
    "; curl " + cookbookDownloadUrl + " > " + filename,
    "; tar -zxf " + filename
  ];

  var command = commands.join(" ");
  exec(command, function(err, stdout, stderr)
  {
    console.log('Finished downloading cookbook: ' + cookbookName);

    if (err)
      return callback(err, null);

    // Unpacked cookbook, cleanup tar files
    fs.unlinkSync(downloadFile);

    // Return downloadPath
    var cookbookPath = path.join(DOWNLOAD_DIR, cookbookName);
    return callback(null, cookbookPath);
  });
}


/*******************************************************************************
 * GetMetadataPath
 *******************************************************************************
 * Do some cleanup and basic checking on the input cookbook path.
 *
 * Inputs:
 *   argPath:
 */
function GetMetadataPath(argPath)
{
  // Convert relative to absolute
  argPath = path.resolve(argPath);
  var metaPath = "";

  // See if metadata.json is part of path, if not append it
  if (!argPath.match('metadata.json'))
    metaPath = path.join(argPath, 'metadata.json');

  // If the json doesn't exist, add the ruby
  if (!existsSync(metaPath))
    metaPath = path.join(argPath, 'metadata.rb');

  return metaPath;
}


/*******************************************************************************
 * GetDependencies
 *******************************************************************************
 * Convenience wrapper to parse either JSON or metadata.rb and return list of
 * dependencies
 *
 * Inputs:
 *   cookbookPath:
 *
 *   callback:
 */
function GetDependencies(cookbookPath, callback)
{
  var metaPath = GetMetadataPath(cookbookPath);

  if (!existsSync(metaPath))
    return callback('ERROR - Could not find metadata file at the given cookbook path', null);

  if (metaPath.match('metadata.json'))
  {
    // Use JSON parser
    ParseMetadataJson(metaPath, callback);
  }
  else
  {
    // Use Ruby Parser
    ParseMetadataRuby(metaPath, callback);
  }
}


/*******************************************************************************
 * GetCookbook
 *******************************************************************************
 * Downloads the cookbook and returns its path
 *
 * Inputs:
 *   cookbookName:
 *
 *   callback:
 */
function GetCookbook(cookbookName, callback)
{
  console.log('Downloading cookbook: ' + cookbookName);
  // Get download URL
  GetCookbookTarballUrl(cookbookName, function(err, url)
  {
    if (err)
      return callback(err, null);

    // Download the tarball
    DownloadCookbookTarball(url, cookbookName, callback);
  });
}


/*******************************************************************************
 * EnsurePresent
 *******************************************************************************
 * Recurse through the cookbooks and ensure they are downloaded and their
 * dependencies
 *
 * Inputs:
 *   cookbookName:
 */
function EnsurePresent(cookbookName, callback)
{
  // Check the hashmap for cookbook
  if (COOKBOOKS_MAP[cookbookName])
    return callback();

  // Need to download it
  GetCookbook(cookbookName, function(err, path)
  {
    if (err)
      return callback(err);

    COOKBOOKS_MAP[cookbookName] = path;

    // Get Dependencies
    GetDependencies(path, function(err, deps)
    {
      if (err)
        return callback(err);

      // Make sure all deps are downloaded
      var numDeps = _.size(deps);

      if (numDeps === 0)
        return callback();

      var taskRunner = new task_runner.TaskRunner();

      // Download Deps
      _.forEach(deps, function(value, name)
      {
        taskRunner.add( EnsurePresentTask.bind(null, name) );
      });
      
      
      // Control how 'parallel' we want things to run in taskrunner
      // 1 means run in serial
      taskRunner.run(function()
      {
        callback();
      }, 4);
    });
  });
}


/*******************************************************************************
 * EnsurePresentTask()
 *******************************************************************************
 * TaskRunner task for calling EnsurePresent.
 *
 * Inputs:
 *   name:
 *
 *   next:
 */
function EnsurePresentTask(name, next)
{
  try
  {
    EnsurePresent(name, function(error)
    {
      if (error)
        console.log('EnsurePresentTask: error ' + util.inspect(error));

      next();
    } );
  }
  catch (ex)
  {
    console.log('EnsurePresentTask: exception ' + util.inspect(ex));
    next();
  }
}


/*******************************************************************************
 * Main Function
 *******************************************************************************
 * Takes input to target cookbook from console
 *
 * Inputs:
 *   argv.c:
 */
if (argv.c)
{
  // Get Deps
  setTimeout(function()
  {
    GetDependencies(argv.c, function(err, cookbooks)
    {
      if (err)
        return console.log(err);

      var numDeps = _.size(cookbooks);

      if (numDeps === 0)
      {
        console.log('No dependencies!');
        return;
      }

      var taskRunner = new task_runner.TaskRunner();

      // Hash of cookbooks found
      _.each(cookbooks, function(value, name)
      {
        taskRunner.add( EnsurePresentTask.bind(null, name) );
      });

      taskRunner.run(function()
      {
        console.log('All done!');
      }, 4);

    });
  }, 1000 );
}
