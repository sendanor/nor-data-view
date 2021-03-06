/** Builder for data views */

"use strict";

var _Q = require('q');
var debug = require('nor-debug');
var merge = require('merge');
var copy = require('nor-data').copy;
var is = require('nor-is');
var ARRAY = require('nor-array');
var FUNCTION = require('nor-function');
var strip = require('./strip.js');
var ref = require('nor-ref');

var NOR_DATA_VIEW_SLOW_STATS = is.enabled(process.env.NOR_DATA_VIEW_SLOW_STATS) ? true : debug.isDevelopment();

/** Returns unique array */
function array_unique(a) {
	return ARRAY(a).reduce(function(p, c) {
		if (p.indexOf(c) < 0) {
			p.push(c);
		}
		return p;
	}, []);
}

/** Compute keys */
function compute_keys(body, opts, req, res) {
	debug.assert(body).is('object');
	debug.assert(opts).is('object');
	return ARRAY(Object.keys(opts)).map(function(key) {
		debug.assert(opts[key]).is('function');
		return function compute_step() {

			var time;

			if(NOR_DATA_VIEW_SLOW_STATS) {
				time = process.hrtime();
			}

			return _Q.when(opts[key].call(body, req, res)).then(function(value) {
				//debug.log('value = ', value);
				if(is.defined(value)) {
					body[key] = value;
				}

				if(NOR_DATA_VIEW_SLOW_STATS) {
					var diff = process.hrtime(time);
					var speed = (diff[0] * 1e9 + diff[1]) / 1000000000;
					if(speed >= 0.05) {
						debug.warn('computing ', body.$type + '#' + key, ' took', speed, ' s');
					} else if(speed >= 0.005) {
						debug.log('computing ', body.$type + '#' + key, ' took', speed, ' s');
					}
				}
			});
		};
	}).reduce(_Q.when, _Q()).then(function() {
		return body;
	});
}

/** */
function fix_object_ids(o) {
	if(is.obj(o) && is.uuid(o.$id)) {
		//debug.log('entry in path: ', o);
		return o.$id;
	}
	return o;
}

/** Render `path` with optional `params` */
function render_path(path, params) {
	params = params || {};
	return ARRAY([]).concat(is.array(path) ? path : [path]).map(function(p) {
		return p.replace(/:(\$?[a-z0-9A-Z\-\_]+)/g, function(match, key) {
			if(params[key] === undefined) {
				return ':'+key;
			}
			return ''+fix_object_ids(params[key]);
		});
	}).valueOf();
}

/** Builds a builder for REST data views */
function ResourceView(opts) {
	var view = this;
	opts = merge({}, opts);

	debug.assert(opts).is('object');
	debug.assert(opts.path).is('string');
	debug.assert(opts.keys).ignore(undefined).is('array');

	view.opts = {};
	view.opts.keys = [].concat( opts.keys || ['$id', '$type', '$ref'] );
	view.opts.path = ''+opts.path;

	view.Type = opts.Type;

	if(is.obj(opts.compute_keys)) {
		view.compute_keys = opts.compute_keys;
	}

	if(is.obj(opts.element_keys)) {
		view.element_keys = opts.element_keys;
	}

	if(is.obj(opts.collection_keys)) {
		view.collection_keys = opts.collection_keys;
	}

	// view.opts.accepted_keys
	if(is.array(opts.accepted_keys)) {
		view.opts.accepted_keys = opts.accepted_keys;
	} else {
		view.opts.accepted_keys = view.opts.keys;
	}

	// view.opts.secret_keys
	view.opts.secret_keys = array_unique( is.array(opts.secret_keys) ? opts.secret_keys : [] );

	// Filter view.opts.accepted_keys
	view.opts.accepted_keys = ARRAY(array_unique([]
		.concat(view.opts.accepted_keys)
		.concat(is.obj(view.compute_keys) ? Object.keys(view.compute_keys) : [])
		.concat(is.obj(view.element_keys) ? Object.keys(view.element_keys) : [])
		.concat(is.obj(view.collection_keys) ? Object.keys(view.collection_keys) : [])
	)).filter(function(key) {
		return view.opts.secret_keys.indexOf(key) === -1;
	}).valueOf();

	//debug.log("view.opts = ", view.opts);
}

ResourceView.views = {};

/** Returns build function for a data view of REST element */
ResourceView.prototype.element = function(req, res, opts) {
	var view = this;

	debug.assert(req).is('object');
	debug.assert(res).is('object');
	//debug.log('view.opts = ', view.opts);
	//debug.log('opts = ', opts);
	debug.assert(view.opts).is('object');
	opts = merge({}, view.opts, opts || {});
	//debug.log('(after) opts = ', opts);

	// opts.accepted_keys
	if(!is.array(opts.accepted_keys)) {
		//opts.accepted_keys = opts.accepted_keys;
	//} else {
		opts.accepted_keys = [].concat(opts.keys);
	}

	opts.secret_keys = array_unique( is.array(opts.secret_keys) ? opts.secret_keys : [] );

	opts.accepted_keys = ARRAY(array_unique([]
		.concat(opts.accepted_keys)
		.concat(is.obj(opts.compute_keys) ? Object.keys(opts.compute_keys) : [])
		.concat(is.obj(view.compute_keys) ? Object.keys(view.compute_keys) : [])
		.concat(is.obj(view.element_keys) ? Object.keys(view.element_keys) : [])
	)).filter(function(key) {
		return opts.secret_keys.indexOf(key) === -1;
	}).valueOf();

	var views = opts.views || ResourceView.views;
	return function data_view_element_0(item) {
		return _Q.fcall(function data_view_element_1() {

			if(is.string(item)) {
				debug.assert(item).is('uuid');
				item = {'$id': item};
			}
			debug.assert(item).is('object');

			//debug.log('opts.params = ', opts.params);
			//debug.log('item = ', item);

			opts.params = is.obj(opts.params) ? opts.params : {};
			var params = merge(opts.params, item);

			//debug.log('params = ', params);

			if(is.array(item)) {
				debug.warn("ResourceView.prototype.element() called with an Array. Is that what you intended?");
			}

			var body = strip(item).specials().get();
			return ARRAY(opts.keys).map(function data_view_element_2(key) {
				return function do_step() {
					return _Q.fcall(function create_promise() {
						var path;

						if(opts.elementPath) {
							path = [req].concat(render_path(opts.elementPath, params));
						} else {
							path = [req].concat(render_path(opts.path, params)).concat([item.$id]);
						}
						//debug.log("path = ", FUNCTION(ref).curryApply(path));

						// 
						if( (key === '$ref') && is.uuid(item.$id) ) {
							return FUNCTION(ref).curryApply(path);
						}

						// 
						if( is.uuid(item[key]) && is.object(views[(''+key).toLowerCase()]) ) {
							return views[key].element(req, res)(item[key]);
						}

						// 
						if( is.object(item[key]) && is.uuid(item[key].$id) && is.undef(item[key].$ref) && is.object(views[(''+key).toLowerCase()]) ) {
							return views[key].element(req, res)(item[key]);
						}

						// 
						if(item[key] !== undefined) {
							return item[key];
						}
					}).then(function catch_promise_value(value) {
						body[key] = value;
					}); // End of return _Q.fcall(function() { .. }
				}; // End of return function() { .. }
			}).reduce(_Q.when, _Q()).then(function get_body() {
				return body;
			}); // End of opts.keys.map(...).reduce()...

		}).then(function(body) {

			//debug.log('body = ', body);

			if(!body.$type) {
				body.$type = view.Type;
			}

			if(is.obj(view.compute_keys)) {
				return compute_keys(body, view.compute_keys, req, res);
			}
			return body;

		}).then(function data_view_element_3(body) {
			if(is.obj(view.element_keys)) {
				return compute_keys(body, view.element_keys, req, res);
			}
			return body;

		}).then(function data_view_element_4(body) {
			if(is.obj(opts.compute_keys)) {
				return compute_keys(body, opts.compute_keys, req, res);
			}
			return body;
		}).then(function data_view_strip(body) {

			// Strip all keys that are not listed in accepted keys or are listed on opts.secret_keys
			//debug.log('opts.accepted_keys = ', opts.accepted_keys);
			//debug.log('opts.secret_keys = ', opts.secret_keys);
			ARRAY(Object.keys(body)).filter(function(key) {
				return (opts.accepted_keys.indexOf(key) === -1) || (opts.secret_keys.indexOf(key) !== -1);
			}).forEach(function(key) {
				delete body[key];
			});

			return body;
		}); // End of _Q.fcall()
	}; // end of function(item)
};

/** Returns build function for a data view of REST collection -- which is a collection of REST elements */
ResourceView.prototype.collection = function(req, res, opts) {
	var view = this;
	debug.assert(req).is('object');
	debug.assert(res).is('object');
	//debug.log("view.opts = ", view.opts);
	//debug.log("opts = ", opts);
	opts = merge({}, view.opts, opts || {});
	//debug.log("(after) opts = ", opts);

	// opts.accepted_keys
	if(!is.array(opts.accepted_keys)) {
		//opts.accepted_keys = opts.accepted_keys;
	//} else {
		opts.accepted_keys = [].concat(opts.keys);
	}

	opts.secret_keys = array_unique( is.array(opts.secret_keys) ? opts.secret_keys : [] );

	opts.accepted_keys = ARRAY(array_unique(['$']
		.concat(opts.accepted_keys)
		.concat(is.obj(opts.compute_keys) ? Object.keys(opts.compute_keys) : [])
		.concat(is.obj(view.compute_keys) ? Object.keys(view.compute_keys) : [])
		.concat(is.obj(view.element_keys) ? Object.keys(view.element_keys) : [])
		.concat(is.obj(view.collection_keys) ? Object.keys(view.collection_keys) : [])
	)).filter(function(key) {
		return opts.secret_keys.indexOf(key) === -1;
	});

	return function data_view_collection_0(items) {
		return _Q.fcall(function data_view_collection_1() {
			//debug.log('items = ', items);
			debug.assert(items).is('array');
			var element_opts = copy(opts);
			var rendered_path = render_path(element_opts.path, element_opts.params);
			var path = [req].concat(rendered_path);
			if(opts.elementPath) {
				element_opts.path = opts.elementPath;
			}
			//debug.log("element_opts = ", element_opts);
			var body = {};
			body.$ref = FUNCTION(ref).curryApply(path);
			body.$ = [];

			if(opts.limit) {
				body.limit = opts.limit;
			}

			return ARRAY(items).map(function build_steps(item) {
				return function do_step() {
					return view.element(req, res, element_opts)(item).then(function add_item(i) {
						body.$.push(i);
					});
					/* end of do_step */
				};

			/* end of build_steps */
			}).reduce(_Q.when, _Q()).then(function get_body() {
				//debug.log('body = ', body);
				return body;
			}); /* get_body */

		}).then(function data_view_collection_2(body) {

			if(is.obj(view.compute_keys)) {
				//debug.log('body = ', body);
				return compute_keys(body, view.compute_keys, req, res);
			}

			//debug.log('body = ', body);
			return body;

		}).then(function data_view_collection_3(body) {

			if(is.obj(view.collection_keys)) {
				//debug.log('body = ', body);
				return compute_keys(body, view.collection_keys, req, res);
			}

			//debug.log('body = ', body);
			return body;

		}).then(function data_view_collection_4(body) {
			if(is.obj(opts.compute_keys)) {
				//debug.log('body = ', body);
				return compute_keys(body, opts.compute_keys, req, res);
			}
			//debug.log('body = ', body);
			return body;
		}).then(function data_view_collection_strip(body) {

			// Strip all keys that are not listed in accepted keys or are listed on opts.secret_keys
			//debug.log('opts.accepted_keys = ', opts.accepted_keys);
			//debug.log('opts.secret_keys = ', opts.secret_keys);
			ARRAY(Object.keys(body)).filter(function(key) {
				return (opts.accepted_keys.indexOf(key) === -1) || (opts.secret_keys.indexOf(key) !== -1);
			}).forEach(function(key) {
				delete body[key];
			});

			return body;
		}); // End of _Q.fcall
	}; // End of data_view_collection_0
}; // End of ResourceView.prototype.collection

// Exports

module.exports = ResourceView;

/* EOF */
