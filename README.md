Chef Cookbook Dependency Downloader
===================================
nodejs script to recursively download all dependency cookbooks for a given target cookbook.


Requirements
-------------
This script has been tested with:

* node v0.6.x and newer


Installation
-------------
Assuming you already have node and npm installed:

1. `cd /path/to/chef-cookbook-dependency-downloader`
2. `npm install -d`


Usage
-----
The script requires you pass the path to your target cookbook when invoked as follows:

`node downloader.js -c test-cookbook/`


Example
-------
Included in the project, in the test-cookbook folder, is a metadata.json file taken from the [chef-graphite cookbook](https://github.com/hw-cookbooks/graphite) created by [Heavy Water](https://github.com/hw-cookbooks)


License and Author
==================

- Author:: Vik Bhatti (vik@vikbhatti.com)
