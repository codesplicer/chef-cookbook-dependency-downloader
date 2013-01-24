/*******************************************************************************
 * Task Runner Module
 *******************************************************************************
 * Tries to throttle some of the async madness in node. Useful script
 * when debugging async issues
 *
 *
 */

var task_runner = module.exports;

task_runner.TaskRunner = function()
{
  this.tasks = [];
  this.concurrency = 0;
  this.done = null;
  this.maxConcurrency = 10;
  this.numTasksInProgress = 0;
};

task_runner.TaskRunner.prototype = {
  add: function(callback)
  {
    this.tasks.push(callback);
  },

  numTasks: function()
  {
    return this.tasks.length;
  },

  run: function(done, maxConcurrency)
  {
    if (this.numTasks() === 0)
    {
      if (done)
        done();

      return;
    }

    this.done = done || this.done;
    this.maxConcurrency = maxConcurrency || this.maxConcurrency;
    var target = this.tasks.length;
    var that = this;

    var next = function()
    {
      that.numTasksInProgress--;
      that.concurrency--;
      //      (--target === 0 ? that.done() : that.run());
      if (that.tasks.length === 0 && that.numTasksInProgress === 0)
        that.done();
      else
        that.run();
    };

    while (this.concurrency < this.maxConcurrency && this.tasks.length > 0)
    {
      this.concurrency++;
      var callback = this.tasks.shift();
      this.numTasksInProgress++;
      callback(next);
    }
  }
};
