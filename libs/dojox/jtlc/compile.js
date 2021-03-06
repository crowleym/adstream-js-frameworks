// Copyright (C) 2010-2011 Adstream Holdings
// All rights reserved.
// Redistribution and use are permitted under the modified BSD license
// available at https://github.com/MaxMotovilov/adstream-js-frameworks/wiki/License

dojo.provide( "dojox.jtlc.compile" );

if( dojo.config.isDebug || dojo.config.jtlcIsReadable )
	dojo.require( "dojox.jtlc.prettyPrint" );

dojox.jtlc._varNameLetters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";		

dojox.jtlc._varName = function( n )
{
	var r = dojox.jtlc._varNameLetters.charAt( n % 52 );
	n = Math.floor( n / 52 );
	while( n > 0 ) {
		r += dojox.jtlc._varNameLetters.charAt( n % 62 );
		n = Math.floor( n / 62 );
	}
	return r;
}

dojox.jtlc.stringLiteral = function( s )
{
	return '"' + s.toString().replace( /[\\"\r\n\t]/g, function(x){ return { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '' /* Thank you, Bill Gates! */ }[x]; } ) + '"';
}

dojox.jtlc.arrayAppend = function( dst, src )
{
	src.unshift( 0 );
	src.unshift( dst.length );
	dst.splice.apply( dst, src );
}

dojox.jtlc._replaceWithinJavascriptAll = function( s, context, repl ) 
{
	return s.replace( /((?:.|[\r\n])*?)((["']).*?[^\\]?\2|$)/g, function( _1, code, trailing ) {
		return code.replace( context, repl ) + trailing;
	} )
}

dojox.jtlc._replaceWithinJavascriptOnce = function( s, context, repl ) 
{
	var once = false;
	return s.replace( /((?:.|[\r\n])*?)((["']).*?[^\\]?\2|$)/g, function( _1, code, trailing ) {
		if( once ) return code + trailing;
		var v = code.replace( context, repl );
		if( v != code )	once = true;
		return v + trailing;
	} )
}

dojox.jtlc.replaceWithinJavascript = function( s, context, repl ) 
{
	return context instanceof RegExp && context.global ? 
		dojox.jtlc._replaceWithinJavascriptAll( s, context, repl ) :
		dojox.jtlc._replaceWithinJavascriptOnce( s, context, repl );
}

dojox.jtlc._eval = function( x ){
	return eval( x );
}

dojox.jtlc._optimizeExtraBrackets = function( body ) {
	var new_body;
	while( (
		new_body = dojox.jtlc.replaceWithinJavascript( 
			body, /([^a-z0-9_]|^)\(((?:_|[a-z])[a-z0-9]*)\)/ig, '$1$2' 
		)
	) != body )
		body = new_body;

	return body;
}

dojox.jtlc.compile = function( tpl, lang, mixin ) 
{
	var	state = {
		globals: { names: [], values: [] },
		locals: [],
		max_local: 0,
		code: ["var $=arguments"],
		expressions: [],
		optimizers: dojo.config.isDebug || dojo.config.jtlcIsReadable ? { '_optimizeExtraBrackets': dojox.jtlc._optimizeExtraBrackets } : {}
	};

	if( mixin )	state = dojo.mixin( {}, mixin, state );
	state = dojo.delegate( lang, state );

	state.compileArguments = { language: lang, options: mixin };

	state.compileBody( tpl );

	while( state.locals.length < state.max_local )
		state.addLocal();

	if( state.max_local )
		state.code[0] += ',' + state.locals.join( ',' );
	state.code[0] += ';';

	state.code.push( 'return ' + state.popExpression() + ';' );

	var body = state.code.join('');

	body = state.optimize( body );

	if( ( dojo.config.isDebug || dojo.config.jtlcIsReadable ) && !dojo.isIE )	
		body = dojox.jtlc.prettyPrint( body );

	return state.decorate( state.makeClosure( body ).apply( null, state.globals.values ) );
}

dojo.declare( 'dojox.jtlc.Language', null, {
	
	/* Default settings */

	singletonQuery: {
		failOnNoResults:	false,
		failOnManyResults:	false
	},

	elideNulls:				false,
	failOnDuplicateKeys:	false,

	/* Constructor: incorporates setting changes */

	constructor: function( settings ) {
		if( settings ) {
			dojo.mixin( this, settings );
			for( var i in settings )
				if( settings.hasOwnProperty(i) && i in this.constructor.prototype )
					this[i] = dojo.mixin( {}, this.constructor.prototype[i], this[i] );
		}
	},

	/* Core functionality */

	compileBody: function( tpl ) {
		return this.compile( tpl );
	},

	compile: function( tpl ) {
		var t = typeof( tpl );
		if( t in this )	this[t]( tpl );
		else throw Error( "Unexpected " + t + " value in template: " + tpl.toString() );
	},

	optimize: function( body ) {
		for( var i in this.optimizers )
			body = this.optimizers[i].call( this, body );
		return body;
	},

	addGlobal: function( value ) {

		for( var i=0; i<this.globals.values.length; ++i )
			if( this.globals.values[i] === value )
				return this.globals.names[i];

		var name = '_' + dojox.jtlc._varName( this.globals.names.length );
		this.globals.names.push( name );
		this.globals.values.push( value );
		return name;
	},

	addLocal: function() {
		var name = dojox.jtlc._varName( this.locals.length );
		this.locals.push( name );
		if( this.locals.length > this.max_local )	this.max_local = this.locals.length;
		return name;
	},

	popExpression: function() {
		var expr = this.expressions.pop();
		if( this.locals.length && this.locals[this.locals.length-1] === expr )
			this.locals.pop();
		return expr;
	},

	decorate: function( f ) { return f; },

	makeClosure: dojo.isIE ?
		function( inner_body ) {
			// Known to work on Mozilla, Chrome & IE7
			return new Function( this.globals.names, "function $self(){" + inner_body + "} return $self;" );
		} :
		new Function( // Should reside in global scope to minimize chances of namespace pollution
			'inner_body',
			'return dojox.jtlc._eval( "(function(" + this.globals.names.join(",") + "){function $self(){" + inner_body + "} return $self;})" +\
						  (this.sourceUrl ? "\\r\\n//@ sourceURL=" + this.sourceUrl : "") );'
		),

	/* Internal settings that can be overridden by tags */

	current_input: '$[0]',
	
	/* Common patterns */

	accumulated: function( init, sink, loop, inner ) {

		var old_sink = this.sink,
			old_loop = this.loop;

		if( old_sink !== sink ) {
			this.sink = sink;
			if( init ) this.code.push( this.sink.accumulator + init );
		}

		if( loop !== old_loop ) {
			if( loop )	this.loop = loop;
			else		delete this.loop;
		}

		var	old_current_input = this.hasOwnProperty( 'current_input' ) ? this.current_input : null;

		if( old_loop && loop !== old_loop && old_loop.lockedItem )
			this.current_input = '(' + old_loop.item() + ')';

		inner.call( this );

		if( old_current_input !== ( this.hasOwnProperty( 'current_input' ) ? this.current_input : null ) ) {
			if( old_current_input )	this.current_input = old_current_input;
			else 					delete this.current_input; 			
		}

		if( loop !== old_loop ) {
			if( old_loop )	this.loop = old_loop;
			else			delete this.loop;
		}

		if( old_sink !== sink ) {
			this.expressions.push( this.sink.accumulator );
			if( old_sink )	this.sink = old_sink;
			else			delete this.sink;
		}
	},

	nonAccumulated: function( inner, current ) {
		var old_loop = this.loop;

		if( this.loop )	delete this.loop;

		var	old_current_input = this.hasOwnProperty( 'current_input' ) ? this.current_input : null;

		if( current )	this.current_input = current;
		else if( old_loop && old_loop.lockedItem )
			this.current_input = '(' + old_loop.item() + ')';

		inner.call( this );

		if( old_current_input !== ( this.hasOwnProperty( 'current_input' ) ? this.current_input : null ) ) {
			if( old_current_input )	this.current_input = old_current_input;
			else					delete this.current_input; 			
		}

		if( old_loop )	this.loop = old_loop;
	},

	generator: function( expr ) {

		if( !expr )	expr = this.current_input;

		if( this.loop ) {

			if( !this.loop.started() ) {
				this.loop.begin( expr );
			}

			this.expressions.push( this.loop.item() );

		} else {
			this.expressions.push( expr );
		}
	},

	/* Built-in object handlers */

	object: function( tpl ) {
		if( tpl === null ) {
			this.nullValue();
		} else if( 'compile' in tpl ) {
			tpl.compile.call( this, tpl );
		} else if( tpl.constructor === Array ) {
			this.array( tpl );
		} else if( tpl.constructor !== Object ) {
			this.unknownObject( tpl );
		} else this.dictionary( tpl )
	},

	dictionary: function( tpl ) {
		this.accumulated( '={};', new dojox.jtlc._DictionarySink( this ), null, 
			function() {
				for( var i in tpl ) {
					if( tpl.hasOwnProperty(i) )	{
						this.sink.key = dojox.jtlc.stringLiteral( i );
						this.compile( tpl[i] );
						this.sink.append();
					}
				}
			}
		);
	},

	array: function( tpl ) {
		this.accumulated( '=[];', new dojox.jtlc._ArraySink( this ), new dojox.jtlc._Loop( this ), 
			function() {
				for( var i=0; i<tpl.length; ++i ) {
					if( tpl.hasOwnProperty(i) )	{
						this.compile( tpl[i] );
						this.sink.append();
					}
				}
			}
		);
	},

	unknownObject: function( tpl ) {
		throw Error( "Unexpected object in the template: " + tpl.toString() );
	},

	nullValue: function() {
		throw Error( "Unexpected null value in the template" );
	}
});

dojo.declare( 'dojox.jtlc._Sink', null, {

	constructor: function( compiler ) {
		this.compiler = compiler;
		this.loops_to_close = [];
	},

	closeLoops: function() {
		while( this.loops_to_close.length > 0 )
			this.loops_to_close.pop().end();
	}

} );

dojo.declare( 'dojox.jtlc._DictionarySink', dojox.jtlc._Sink, {

	constructor: function() {
		this.accumulator = this.compiler.addLocal();
	},

	append: function() {
		if( this.compiler.elideNulls || this.compiler.failOnDuplicateKeys ) {
			this.compiler._dictionaryAppend = this.compiler._dictionaryAppend || this.compiler.addGlobal( new Function( 
				"d", "k", "v",
				( this.compiler.failOnDuplicateKeys ? 
					"if( k in d ) throw Error( 'Duplicate key ' + dojox.jtlc.stringLiteral(k) );" 
				: "" ) +
			    ( this.compiler.elideNulls ? "if( v !== null )" : "" ) +  "d[k]=v;"
			) );
			this.compiler.code.push( 
				this.compiler._dictionaryAppend + '(' + this.accumulator + ',' + this.key + ',' +
		        this.compiler.popExpression() + ');'
			);
		} else this.compiler.code.push(
			this.accumulator + '[' + this.key + ']=' + this.compiler.popExpression() + ';'
		);

		this.closeLoops();
	}
} );

dojo.declare( 'dojox.jtlc._ArraySink', dojox.jtlc._Sink, {

	constructor: function() {
		this.accumulator = this.compiler.addLocal();
	},

	append: function() {

		if( !( '_arrayOptimizer' in this.compiler.optimizers ) )
			this.compiler.optimizers._arrayOptimizer = this.optimize;

		if( this.compiler.elideNulls ) {
			this.compiler._arrayAppend = this.compiler._arrayAppend || this.compiler.addGlobal( 
				function(a,v){ if(v) a.push(v); }
			);
			this.compiler.code.push(
				this.compiler._arrayAppend + '(' + this.accumulator + ',' + this.compiler.popExpression() + ');'
			);
		} else this.compiler.code.push( 
			this.accumulator + '.push(' + this.compiler.popExpression() + ');'
		);

		this.closeLoops();
	},

	optimize: function( body ) { // Visitor on the compiler object!
		var _this = this;
		return dojox.jtlc.replaceWithinJavascript( 
			body,
			/for\(([a-zA-Z][a-zA-Z0-9]*)=0;\1<([a-zA-Z][a-zA-Z0-9]*).length;\+\+\1\){([a-zA-Z][a-zA-Z0-9]*)\.push\(\2\[\1\]\);}/g, 
			function( _0, _1, src, dst ) {
				var g = _this.addGlobal( dojox.jtlc.arrayAppend );
				return g + '(' + dst + ',' + src + ')';
			}
		);
	}
} );

dojo.declare( 'dojox.jtlc._Loop', null, {

	constructor: function( compiler ) {
		this.compiler = compiler;
	},

	begin: function( init ) {
		if( this._items )	throw Error( "Internal error: loop initialized twice" );
		this._items = this.compiler.addLocal();
		this._i = this.compiler.addLocal();
		this.compiler.code.push( 
			( init === this._items ? '' : this._items + '=' + init + ';' ) +
			'for(' + this._i + '=0;' + this._i + '<' + this._items + '.length;++' + this._i + '){' 
		);
		if( this.compiler.sink )	this.compiler.sink.loops_to_close.push( this );
	},

	item: function() {
		if( !this._items )	throw Error( "Internal error: loop not initialized" );
		return this.lockedItem || this._items + '[' + this._i + ']';
	},

	lockItem: function( item ) {
		if( !this._items )	
			throw Error( "_Loop.lockItem() called out of sequence" );

		var	cur_item = this.item();

		if( item != cur_item && '(' + item + ')' != cur_item ) {

			this.lockedItemVar = this.lockedItemVar || this.compiler.addLocal();

			if( this.lockedItemVar != item )
				this.compiler.code.push( this.lockedItemVar + '=' + item + ';' );

			this.lockedItem = '(' + this.lockedItemVar + ')';
		} else {
			this.lockedItem = item;
		}
	},

	count: function() {
		if( !this._items )	throw Error( "Internal error: loop not initialized" );
		return '(' + this._i + ')';
	},

	end: function() {
		if( !this._items )	throw Error( "Internal error: loop not initialized" );
		delete this._items;
		delete this._i;
		this.compiler.code.push( '}' );
		if( this.lockedItemVar )	this.compiler.locals.pop();
		this.compiler.locals.pop();
		this.compiler.locals.pop();
	},

	started: function() {
		return !!this._items;
	}
} );


