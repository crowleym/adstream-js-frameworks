// Copyright (C) 2011 Adstream Holdings
// All rights reserved.
// Redistribution and use are permitted under the modified BSD license
// available at https://github.com/MaxMotovilov/adstream-js-frameworks/wiki/License

dojo.provide( "dojox.jtlc.parseExpression" );

(function(){

var d = dojo;

// Copied from compile.js to avoid an unnecessary dependency
function stringLiteral( s ) {	
	return '"' + s.toString().replace( /[\\"\r\n\t]/g, function(x){ return { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '' /* Thank you, Bill Gates! */ }[x]; } ) + '"';
}

function copyArguments( args, offs ) {
	return Array.prototype.slice.call( args, offs || 0 );
}

//
//	Meta-compiler for grammar definitions
//

function cacheKey( /* ... */ ) {
	return copyArguments( arguments ).join( '\uffff' );
}

//	Matcher function: this.matcher() -> { in_pri:, out_pri:, out_mode: } or null

var maker_cache = {};

function makeRule( before, in_pri, out_pri, out_mode ) {

	function make() {

		var	pos = 0, last_arg, body = [];

		function checkLiteral( offs ) {
			if( offs>pos )	body.push( 
				d.replace( 'if(this.token({0})!=={1})return false;', [ "{0}", stringLiteral( before.substring( pos, offs ) ) ] )
			);
		}

		before.replace( /[#@]/g, function( arg, offs ) {
			checkLiteral( offs );
			pos = offs + arg.length;
			body.push( d.replace( 'if(this.type({0})!="{1}")return false;', [ "{0}", last_arg = arg ] ) );
		} );

		checkLiteral( before.length );

		body.reverse();
		body = d.map( body, function( line, index ){ return d.replace( line, [ index ] ); } );

		body.unshift( d.replace( 'if(this.stack.length<{0})return false;', [ body.length ] ) );

		return { 
			matcher: new Function( '', body.join('') + 'return true;' ),
			in_mode: last_arg == '#' && pos == before.length ? '' : last_arg == '@' ? '@' : '#'
		};
	}

	return d.mixin( 
		{ in_pri: in_pri, out_pri: out_pri, out_mode: out_mode },
		maker_cache[before] || (maker_cache[before] = make())
	);
}

//	Popper function: this.popper() -> undefined (replaces top of the stack)

var popper_cache = {};

function makePopper( before, after ) {

	var cache_key = cacheKey( before, after );
	if( cache_key in popper_cache )	return popper_cache[cache_key];

	var	count = before.replace( /[^#@]+/g, '.' ).length + 1 + (after&&1||0),
		signature = before.replace( /[^#@]/g, '' ) + ':' + after;

	return popper_cache[cache_key] = new Function( '',
		d.replace( 
			'var callback = this.callback("{0}"), args = this.stack.splice( this.stack.length - {1}, {1} );', 
		   [ signature, count ] 
		) +	d.replace( 
			'this.stack.push([ callback.apply(null,dojo.map(args,{1})), "{0}" ]);', 
			[ after === '@' ? '@' : '#', 'function(i){return i[0];}' ] 
		)
	);
}

function compileRule( key, rule ) {

	var splits = rule.split( key ),
		before = /^(.*?)(\d+)$/.exec( splits.slice( 0, splits.length-1 ).join( key ) ),
		after = /^(\d+)([#@]?)$/.exec( splits[ splits.length-1 ] );

	if( splits.length < 2 || !before || !after )	throw Error( "BUG -- illegal rule syntax for key " + key + ": " + rule );

	return d.mixin( 
		{ popper: makePopper( before[1], after[2] ) }, 
		makeRule( before[1], parseInt(before[2]), parseInt(after[1]), after[2] ) 
	);
}

function classifyRules( rules ) {
	var result = {};
	d.forEach( rules, function(r) {
		if( r.in_mode in result ) {
			if( result[r.in_mode].in_pri != r.in_pri )	return null;
		} else {
			result[r.in_mode] = { in_pri: r.in_pri, rules: [] };
		}
		result[r.in_mode].rules.push( r );
	} );
	return result;
}

function compileGrammar( grammar ) {
	var	compiled_grammar = {};
	for( var key in grammar )
		if( grammar.hasOwnProperty(key) ) {
			var rules = [];
			for( var i=0; i<grammar[key].length; ) {
				var rule = compileRule( key, grammar[key][i++] );
				if( i<grammar[key].length && typeof grammar[key][i] === 'function' )
					rule.callback = grammar[key][i++];
				rules.push( rule );
			}
			if( !( compiled_grammar[key] = classifyRules( rules ) ) )
				throw Error( "BUG -- conflict between rules for key " + key );
		}
	return compiled_grammar;
}

//	Default semantics -- copy the expression as is

function concatAll() {
	return copyArguments( arguments ).join( '' );
}

function concatAllWithSpaces() {
	return copyArguments( arguments ).join( ' ' );
}

function returnFirst( first ) {
	return first;
}

function unfinishedTernary() {
	throw Error( "Expected :" );
}

function unterminatedString( quote ) {
	throw Error( "Missing " + ( quote == '"' ? 'double' : 'single' ) + " quote" );
}

function unbalancedBracket() {
	throw Error( "Expected " + { '(':')', '[':']', '{':'}' }[ arguments[arguments.length-2] ] );
}

//	Default Javascript expression grammar: extended without copying

var	js_expr_grammar = compileGrammar({
	'(':	[ '#80(1#', unbalancedBracket, '80(1#', unbalancedBracket ],
	')':	[ '#(#2)99', '#(2)99', '(#2)99' ],
	'[':	[ '#90[1#', unbalancedBracket, '90[1#', unbalancedBracket ],
	']':	[ '#[#2]99', '[#2]99', '[2]99' ],
	'{':	[ '90{1#', unbalancedBracket ],
	'}':	[ '{#2}99', '{2}99' ],

	',':	[ '#5,5#' ],

	'?':	[ '#16?10#', unfinishedTernary ],
	':':	[ '#?#11:10#', '#11:6#' ],

	'=':	[ '#16=15#' ],	'+=':	[ '#16+=15#' ],	'-=':	[ '#16-=15#' ],
	'*=':	[ '#16*=15#' ],	'/=':	[ '#16/=15#' ],	'%=':	[ '#16%=15#' ],	
	'|=':	[ '#16|=15#' ],	'&=':	[ '#16&=15#' ],	'^=':	[ '#16^=15#' ],	
	'<<=':	[ '#16<<=15#' ],'>>=':	[ '#16>>=15#' ],'>>>=':	[ '#16>>>=15#' ],	

	'&':	[ '#40&40#' ],	'&&':	[ '#25&&25#' ],
	'|':	[ '#30|30#' ],	'||':	[ '#20||20#' ],
	'^':	[ '#35^35#' ],

	'==':	[ '#45==45#' ],	'===':	[ '#45===45#' ],
	'!=':	[ '#45!=45#' ],	'!==':	[ '#45!==45#' ],

	'<':	[ '#50<50#' ],	'<=':	[ '#50<=50#' ],	
	'>':	[ '#50>50#' ],	'>=':	[ '#50>=50#' ],	

	'in':			[ '#50in50#' ],
	'instanceof':	[ '#50instanceof50#' ],

	'<<':	[ '#55<<55#' ],	'>>':	[ '#55>>55#' ],	'>>>':	[ '#55>>>55#' ],

	'*':	[ '#65*65#' ],	'/':	[ '#65/65#' ],	'%':	[ '#65%65#' ],

	'+':	[ '71+70#', '#60+60#' ],	'-':	[ '71-70#', '#60-60#' ],

	'!':	[ '71!70#' ],	'~':	[ '71~70#' ],

	'typeof':	[ '71typeof70#' ],
	'void':		[ '71void70#' ],
	'delete':	[ '71delete70#' ],

	'++':	[ '#75++100', '71++70#' ],	'--':	[ '#75--100', '71--70#' ],

	'new':	[ '85new86#' ],

	'.':	[ '#95.95#' ],

	'"':	[ '"@2"100', '100"1@', unterminatedString ],
	"'":	[ "'@2'100", "100'1@", unterminatedString ],
	'\\':	[ '@99\\99@' ],

	'<<Number>>': 		[ '100<<Number>>100' ],
	'<<Identifier>>': 	[ '100<<Identifier>>100' ],
	'<<EOS>>':			[ '#0<<EOS>>0', returnFirst ]
});

var Parser = d.extend( 
	function( grammar ) {
		this.stack = [];
		this.mode = '#';
		this.grammar = grammar;
	}, {
		top: function( n ){ 
			return this.stack[ this.stack.length-1-(n||0) ]; 
		},

		token: function( n ){ return this.top(n)[0]; },

		type: function( n ){ return this.top(n)[1]; },

		rule: function( n ){ return this.top(n)[2] || {}; },

		priority: function( n ){ return this.rule(n).out_pri || 0; },

		callback: function( signature ){ 
			return this.rule( signature.length - signature.indexOf( ':' ) - 1 ).callback || 
				   ( signature.indexOf( '@' ) >= 0 ? concatAll : concatAllWithSpaces );
		},

		push: function( token ) {
			var rules = this.grammar[token], rule;

			if( !rules ) {
				if( /^\.?[0-9]/.test( token ) )			
					rules = this.grammar['<<Number>>'];
				else if( rules = this.grammar[token.charAt(0)] )
					;
				else if( /^[a-z_$]/i.test( token ) )
					rules = this.grammar['<<Identifier>>'];
			}

			rules = rules && rules[this.mode];
			if( !rules ) {
				this.skip( token );
				return;
			}

			var	look_at = this.mode == '#' ? 0 : 1;			
			while( this.stack.length > look_at && this.priority( look_at ) >= rules.in_pri )
				this.pop( look_at );

			if( rules ) for( var i=0; i<rules.rules.length; ++i ) {
				if( (rule = rules.rules[i]).matcher.call( this ) )
					break;
				rule = null;
			}

			if( rule ) {
				this.stack.push( [ token, '', rule ] );
				if( !(this.mode = rule.out_mode) )
					this.pop();
				else if( this.mode == '@' )	this.stack.push( [ '', '@' ] );
			} else {
				if( this.stack.length > look_at )	this.pop( look_at ); // A chance at a better error message
				throw Error( 'Unbalanced ' + token );
			}				
		},

		pop: function( n ) {
			var popper = this.rule(n).popper;
			if( popper )	popper.call( this );
		},

		skip: function( chars ) {
			if( this.mode === '@' )	
				this.top()[0] += chars;
			else if( !/^\s+$/.test( chars ) )	
				throw Error( 'Expected ' + ( this.mode=='#' ? 'operand' : 'operator' ) + ' instead of ' + chars );
		}
	}
);

function buildParser( options ) {

	var	scanner, scanner_regex;

	if( options && options.scanner ) {
		if( options.scanner === 'function' )	scanner = options.scanner;
		else	scanner_regex = typeof options.scanner === 'string' ? new RegExp( options.scanner, 'g' ) : options.scanner;
	} else	scanner_regex = // Default Javascript scanner: copy and modify it to extend the expression grammar with new token types
		/(?:["'(),:;?\[\]{}~]|\\.|[%*\/\^]=?|[!=](?:==?)?|\+[+=]?|-[\-=]?|&[&=]?|\|[|=]?|>{1,3}=?|<<?=?|\.\d+(?:e[+\-]?\d+)?|(?!0x)\d+(?:\.\d*(?:e[+\-]?\d+)?)?|\.(?!\d)|0x[0-9a-f]+|[a-z_$][a-z_$0-9]*)/ig;
		//   one-char tokens  esc op/op=... eq/ne..... op/opop/op=...................... comp=/shift=.. decimal from dot.... decimal starting with digit....... dot..... hexadecimal identifier........

	if( !scanner )	scanner = function( str, on_token, on_skip ) { 
		var pos = 0;
		try {
			str.replace( scanner_regex, function( token, offs ) { 
				if( offs > pos )	on_skip( str.substring( pos, offs ) );
				on_token( token );
				pos = offs + token.length;
			} );
			if( pos < str.length )	on_skip( str.substring( pos, str.length ) );
		} catch( e ) {
			throw Error( e.message + ' after ' + str.substring( 0, pos ) );
		}
	}

	var grammar = dojo.mixin( {}, js_expr_grammar, compileGrammar( options && options.grammar || {} ) );

	function body( src ) {
		var parser = new Parser( grammar );
		scanner( src, d.hitch( parser, 'push' ), d.hitch( parser, 'skip' ) );
		try {		
			parser.push( '<<EOS>>' );
		} catch( e ) {
			throw Error( e.message + ' after ' + src );
		}
		return parser.stack.pop()[0];
	}

	return body;
}

dojox.jtlc.parseExpression = function( options, src ) {
	var parser = buildParser( options );
	return src ? parser( src ) : parser;
}

})();
