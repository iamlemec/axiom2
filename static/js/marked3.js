/**
 * marked - a markdown parser
 * Copyright (c) 2011-2014, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/chjj/marked
 */

;(function() {

/**
 * Block-Level Grammar
 */

var block = {
  newline: /^\n+/,
  code: /^`` *\n(?:[^\n]+(?:\n|$))+/,
  fences: noop,
  hr: /^( *[-*_]){3,} *(?:\n+|$)/,
  heading: /^ *(#{1,6})(\*?) *(?:refargs)? *([^\n]+?) *#* *(?:\n+|$)/,
  nptable: noop,
  lheading: /^([^\n]+)\n *(=|-){2,} *(?:\n+|$)/,
  blockquote: /^( q*>[^\n]+(\n(?!def)[^\n]+)*\n*)+/, //added q
  list: /^( *)(bull) [\s\S]+?(?:hr|def|\n{2,}(?! )(?!\1bull )\n*|\s*$)/,
  html: /^ *(?:comment *(?:\n|\s*$)|closed *(?:\n{2,}|\s*$)|closing *(?:\n{2,}|\s*$))/,
  def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +["(]([^\n]+)[")])? *(?:\n+|$)/,
  table: noop,
  paragraph: /^((?:[^\n]+\n?(?!hr|heading|lheading|blockquote|tag|def))+)\n*/,
  text: /^[^\n]+/,
  equation: /^\$\$(\*)? *(?:refargs)? *((?:[^\n]+\n?)*)(?:\n+|$)/,
  title: /^#! *([^\n]*)(?:\n+|$)/,
  image: /^!\[(inside)\]\(href\)(?:\n+|$)/,
  biblio: /^@@ *(?:refid) *\n?((?:[^\n]+\n?)*)(?:\n+|$)/,
  figure: /^@(!|\|) *(?:\[([\w-]+)\]) *([^\n]+)\n((?:[^\n]+\n?)*)(?:\n+|$)/,
  envbeg: /^\>\>(\!)? ([\w-]+)(\*)? (?:refargs)? *((?:[^\n]+\n?)*)(?:\n+|$)/,
  envend: /^\<\<((?:[^\n]+\n?)*)/
};

block._inside = /(?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*/;
block._href = /\s*<?([\s\S]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*/;
block._refid = /\[([\w-]+)\]/;
block._refargs = /(?:\[([\w-\|\=]+)\])/;

block.image = replace(block.image)
  ('inside', block._inside)
  ('href', block._href)
  ();

block.heading = replace(block.heading)
  ('refargs', block._refargs)
  ();

block.equation = replace(block.equation)
  ('refargs', block._refargs)
  ();

block.biblio = replace(block.biblio)
  ('refid', block._refid)
  ();

block.envbeg = replace(block.envbeg)
  ('refargs', block._refargs)
  ();

block.bullet = /(?:[*+-]|\d+\.)/;
block.item = /^( *)(bull) [^\n]*(?:\n(?!\1bull )[^\n]*)*/;
block.item = replace(block.item, 'gm')
  (/bull/g, block.bullet)
  ();

block.list = replace(block.list)
  (/bull/g, block.bullet)
  ('hr', '\\n+(?=\\1?(?:[-*_] *){3,}(?:\\n+|$))')
  ('def', '\\n+(?=' + block.def.source + ')')
  ();

block.blockquote = replace(block.blockquote)
  ('def', block.def)
  ();

block._tag = '(?!(?:'
  + 'a|em|strong|small|s|cite|q|dfn|abbr|data|time|code'
  + '|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo'
  + '|span|br|wbr|ins|del|img)\\b)\\w+(?!:/|[^\\w\\s@]*@)\\b';

block.html = replace(block.html)
  ('comment', /<!--[\s\S]*?-->/)
  ('closed', /<(tag)[\s\S]+?<\/\1>/)
  ('closing', /<tag(?:"[^"]*"|'[^']*'|[^'">])*?>/)
  (/tag/g, block._tag)
  ();

block.paragraph = replace(block.paragraph)
  ('hr', block.hr)
  ('heading', block.heading)
  ('lheading', block.lheading)
  ('blockquote', block.blockquote)
  ('tag', '<' + block._tag)
  ('def', block.def)
  ();

/**
 * Normal Block Grammar
 */

block.normal = merge({}, block);

/**
 * GFM Block Grammar
 */

block.gfm = merge({}, block.normal, {
  fences: /^ *(`{3,}|~{3,})[ \.]*(\S+)? *\n([\s\S]*?)\s*\1 *(?:\n+|$)/,
  paragraph: /^/,
});

block.gfm.paragraph = replace(block.paragraph)
  ('(?!', '(?!'
    + block.gfm.fences.source.replace('\\1', '\\2') + '|'
    + block.list.source.replace('\\1', '\\3') + '|')
  ();

/**
 * GFM + Tables Block Grammar
 */

block.tables = merge({}, block.gfm, {
  nptable: /^ *(\S.*\|.*)\n *([-:]+ *\|[-| :]*)\n((?:.*\|.*(?:\n|$))*)\n*/,
  table: /^ *\|(.+)\n *\|( *[-:]+[-| :]*)\n((?: *\|.*(?:\n|$))*)\n*/
});

/**
 * Block Lexer
 */

function parseArgs(argsraw, number=true) {
  if (!argsraw) {
    return {'number': number};
  }

  var args = {};
  argsraw.split('|')
         .map(x => x.split('='))
         .filter(x => x.length > 1)
         .forEach(x => args[x[0]] = x[1]);

  if ((Object.keys(args).length==0) && argsraw) {
    args['id'] = argsraw;
  }

  if (!('id' in args)) {
    args['id'] = argsraw.split('|')[0];
  }

  if (!('number' in args)) {
    args['number'] = number;
  }

  return args;
}

function Lexer(options) {
  this.tokens = [];
  this.tokens.links = {};
  this.options = options || marked.defaults;
  this.rules = block.tables;
}

/**
 * Expose Block Rules
 */

Lexer.rules = block;

/**
 * Static Lex Method
 */

Lexer.lex = function(src, options) {
  var lexer = new Lexer(options);
  return lexer.lex(src);
};

/**
 * Preprocessing
 */

Lexer.prototype.lex = function(src) {
  src = src
    .replace(/\r\n|\r/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/\u00a0/g, ' ')
    .replace(/\u2424/g, '\n');

  return this.token(src, true);
};

/**
 * Lexing
 */

Lexer.prototype.token = function(src, top, bq) {
  var src = src.replace(/^ +$/gm, '')
    , next
    , loose
    , cap
    , bull
    , b
    , item
    , space
    , i
    , l;

  while (src) {
    // newline
    if (cap = this.rules.newline.exec(src)) {
      src = src.substring(cap[0].length);
      if (cap[0].length > 1) {
        this.tokens.push({
          type: 'space'
        });
      }
    }

    // equation
    if (cap = this.rules.equation.exec(src)) {
      src = src.substring(cap[0].length);
      var number = cap[1] == undefined;
      var argsraw = cap[2] || '';
      var args = parseArgs(argsraw, number);
      this.tokens.push({
        type: 'equation',
        args: args,
        tex: cap[3]
      });
      continue;
    }

    // image
    if (cap = this.rules.image.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'image',
        alt: cap[1],
        href: cap[2]
      });
      continue;
    }

    // figure
    if (cap = this.rules.figure.exec(src)) {
      src = src.substring(cap[0].length);
      var ftype = (cap[1] == '!') ? 'image' : 'table';
      this.tokens.push({
        type: 'figure_start',
        ftype: ftype,
        tag: cap[2],
        title: cap[3]
      });
      this.token(cap[4], top, bq);
      this.tokens.push({
        type: 'figure_end'
      });
      continue;
    }

    // bibliographic info
    if (cap = this.rules.biblio.exec(src)) {
      src = src.substring(cap[0].length);
      var bib = {
        type: 'biblio',
        id: cap[1],
      }
      var lines = cap[2].split('\n');
      for (i in lines) {
        var line = lines[i];
        if (line.includes(':')) {
          var kv = lines[i].split(':');
          var key = kv[0];
          var val = kv.slice(1).join(':').trim();
          bib[key] = val;
        }
      }
      this.tokens.push(bib);
      continue;
    }

    // code
    if (cap = this.rules.code.exec(src)) {
      src = src.substring(cap[0].length);
      cap = cap[0].substring(2).trim();
      this.tokens.push({
        type: 'code',
        text: cap
      });
      continue;
    }

    // fences (gfm)
    if (cap = this.rules.fences.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'code',
        lang: cap[2],
        text: cap[3] || ''
      });
      continue;
    }

    // title
    if (cap = this.rules.title.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'title',
        text: cap[1]
      });
      continue;
    }

    // heading
    if (cap = this.rules.heading.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'heading',
        depth: cap[1].length,
        number: cap[2].length == 0,
        id: cap[3],
        text: cap[4]
      });
      continue;
    }

    // envbeg
    if (cap = this.rules.envbeg.exec(src)) {
      src = src.substring(cap[0].length);
      var end = cap[1] != undefined;
      var number = cap[3] == undefined;
      var argsraw = cap[4] || '';
      var args = parseArgs(argsraw, number);
      this.tokens.push({
        type: 'envbeg',
        end: end,
        env: cap[2],
        text: cap[5],
        args: args
      });
      continue;
    };

    // envend
    if (cap = this.rules.envend.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'envend',
        text: cap[1]
      });
      continue;
    }

    // table no leading pipe (gfm)
    if (top && (cap = this.rules.nptable.exec(src))) {
      src = src.substring(cap[0].length);

      item = {
        type: 'table',
        header: cap[1].replace(/^ *| *\| *$/g, '').split(/ *\| */),
        align: cap[2].replace(/^ *|\| *$/g, '').split(/ *\| */),
        cells: cap[3].replace(/\n$/, '').split('\n')
      };

      for (i = 0; i < item.align.length; i++) {
        if (/^ *-+: *$/.test(item.align[i])) {
          item.align[i] = 'right';
        } else if (/^ *:-+: *$/.test(item.align[i])) {
          item.align[i] = 'center';
        } else if (/^ *:-+ *$/.test(item.align[i])) {
          item.align[i] = 'left';
        } else {
          item.align[i] = null;
        }
      }

      for (i = 0; i < item.cells.length; i++) {
        item.cells[i] = item.cells[i].split(/ *\| */);
      }

      this.tokens.push(item);

      continue;
    }

    // lheading
    if (cap = this.rules.lheading.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'heading',
        depth: cap[2] === '=' ? 1 : 2,
        text: cap[1]
      });
      continue;
    }

    // hr
    if (cap = this.rules.hr.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'hr'
      });
      continue;
    }

    // blockquote
    if (cap = this.rules.blockquote.exec(src)) {
      src = src.substring(cap[0].length);

      this.tokens.push({
        type: 'blockquote_start'
      });

      cap = cap[0].replace(/^ *> ?/gm, '');

      // Pass `top` to keep the current
      // "toplevel" state. This is exactly
      // how markdown.pl works.
      this.token(cap, top, true);

      this.tokens.push({
        type: 'blockquote_end'
      });

      continue;
    }

    // list
    if (cap = this.rules.list.exec(src)) {
      src = src.substring(cap[0].length);
      bull = cap[2];

      this.tokens.push({
        type: 'list_start',
        ordered: bull.length > 1
      });

      // Get each top-level item.
      cap = cap[0].match(this.rules.item);

      next = false;
      l = cap.length;
      i = 0;

      for (; i < l; i++) {
        item = cap[i];

        // Remove the list item's bullet
        // so it is seen as the next token.
        space = item.length;
        item = item.replace(/^ *([*+-]|\d+\.) +/, '');

        // Outdent whatever the
        // list item contains. Hacky.
        if (~item.indexOf('\n ')) {
          space -= item.length;
          item = !this.options.pedantic
            ? item.replace(new RegExp('^ {1,' + space + '}', 'gm'), '')
            : item.replace(/^ {1,4}/gm, '');
        }

        // Determine whether the next list item belongs here.
        // Backpedal if it does not belong in this list.
        if (this.options.smartLists && i !== l - 1) {
          b = block.bullet.exec(cap[i + 1])[0];
          if (bull !== b && !(bull.length > 1 && b.length > 1)) {
            src = cap.slice(i + 1).join('\n') + src;
            i = l - 1;
          }
        }

        // Determine whether item is loose or not.
        // Use: /(^|\n)(?! )[^\n]+\n\n(?!\s*$)/
        // for discount behavior.
        loose = next || /\n\n(?!\s*$)/.test(item);
        if (i !== l - 1) {
          next = item.charAt(item.length - 1) === '\n';
          if (!loose) loose = next;
        }

        this.tokens.push({
          type: loose
            ? 'loose_item_start'
            : 'list_item_start'
        });

        // Recurse.
        this.token(item, false, bq);

        this.tokens.push({
          type: 'list_item_end'
        });
      }

      this.tokens.push({
        type: 'list_end'
      });

      continue;
    }

    // html
    if (cap = this.rules.html.exec(src)) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: this.options.sanitize
          ? 'paragraph'
          : 'html',
        pre: !this.options.sanitizer
          && (cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style'),
        text: cap[0]
      });
      continue;
    }

    // def
    if ((!bq && top) && (cap = this.rules.def.exec(src))) {
      src = src.substring(cap[0].length);
      this.tokens.links[cap[1].toLowerCase()] = {
        href: cap[2],
        title: cap[3]
      };
      continue;
    }

    // table (gfm)
    if (top && (cap = this.rules.table.exec(src))) {
      src = src.substring(cap[0].length);

      item = {
        type: 'table',
        header: cap[1].replace(/^ *| *\| *$/g, '').split(/ *\| */),
        align: cap[2].replace(/^ *|\| *$/g, '').split(/ *\| */),
        cells: cap[3].replace(/(?: *\| *)?\n$/, '').split('\n')
      };

      for (i = 0; i < item.align.length; i++) {
        if (/^ *-+: *$/.test(item.align[i])) {
          item.align[i] = 'right';
        } else if (/^ *:-+: *$/.test(item.align[i])) {
          item.align[i] = 'center';
        } else if (/^ *:-+ *$/.test(item.align[i])) {
          item.align[i] = 'left';
        } else {
          item.align[i] = null;
        }
      }

      for (i = 0; i < item.cells.length; i++) {
        item.cells[i] = item.cells[i]
          .replace(/^ *\| *| *\| *$/g, '')
          .split(/ *\| */);
      }

      this.tokens.push(item);

      continue;
    }

    // top-level paragraph
    if (top && (cap = this.rules.paragraph.exec(src))) {
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'paragraph',
        text: cap[1].charAt(cap[1].length - 1) === '\n'
          ? cap[1].slice(0, -1)
          : cap[1]
      });
      continue;
    }

    // text
    if (cap = this.rules.text.exec(src)) {
      // Top-level should never reach here.
      src = src.substring(cap[0].length);
      this.tokens.push({
        type: 'text',
        text: cap[0]
      });
      continue;
    }

    if (src) {
      throw new
        Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }
  }

  return this.tokens;
};

/**
 * Inline-Level Grammar
 */

var inline = {
  escape: /^\\([\\`*{}\[\]()#+\-.!_>\$])/,
  autolink: /^<([^ >]+(@|:\/)[^ >]+)>/,
  url: noop,
  tag: /^<!--[\s\S]*?-->|^<\/?\w+(?:"[^"]*"|'[^']*'|[^'">])*?>/,
  link: /^!?\[(inside)\]\(href\)/,
  reflink: /^!?\[(inside)\]\s*\[([^\]]*)\]/,
  nolink: /^!?\[((?:\[[^\]]*\]|[^\[\]])*)\]/,
  ilink: /^\[\[([^\]]+)\]\]/,
  strong: /^__([\s\S]+?)__(?!_)|^\*\*([\s\S]+?)\*\*(?!\*)/,
  em: /^\b_((?:[^_]|__)+?)_\b|^\*((?:\*\*|[\s\S])+?)\*(?!\*)/,
  code: /^(`+)\s*([\s\S]*?[^`])\s*\1(?!`)/,
  br: /^ {2,}\n(?!\s*$)/,
  del: noop,
  text: /^[\s\S]+?(?=[\\<!\[_*`\$\^@]| {2,}\n|$)/,
  math: /^\$((?:\\\$|[\s\S])+?)\$/,
  ref: /^@\[([\w-\|\=\:]+)\]/,
  footnote: /^\^\[(inside)\]/
};

inline._inside = /(?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*/;
inline._href = /\s*<?([\s\S]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*/;
inline._refid = /\[([\w-]+)\]/;



inline.link = replace(inline.link)
  ('inside', inline._inside)
  ('href', inline._href)
  ();

inline.reflink = replace(inline.reflink)
  ('inside', inline._inside)
  ();

inline.footnote = replace(inline.footnote)
  ('inside', inline._inside)
  ();


/**
 * Normal Inline Grammar
 */

inline.normal = merge({}, inline);

/**
 * Pedantic Inline Grammar
 */

inline.pedantic = merge({}, inline.normal, {
  strong: /^__(?=\S)([\s\S]*?\S)__(?!_)|^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/,
  em: /^_(?=\S)([\s\S]*?\S)_(?!_)|^\*(?=\S)([\s\S]*?\S)\*(?!\*)/
});

/**
 * GFM Inline Grammar
 */

inline.gfm = merge({}, inline.normal, {
  escape: replace(inline.escape)('])', '~|])')(),
  url: /^(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/,
  del: /^~~(?=\S)([\s\S]*?\S)~~/,
  text: replace(inline.text)
    (']|', '~]|')
    ('|', '|https?://|')
    ()
});

/**
 * GFM + Line Breaks Inline Grammar
 */

inline.breaks = merge({}, inline.gfm, {
  br: replace(inline.br)('{2,}', '*')(),
  text: replace(inline.gfm.text)('{2,}', '*')()
});

/**
 * Inline Lexer & Compiler
 */

function InlineLexer(links, options) {
  this.options = options || marked.defaults;
  this.links = links;
  this.rules = inline.normal;
  this.renderer = this.options.renderer || new Renderer;
  this.renderer.options = this.options;

  if (!this.links) {
    throw new
      Error('Tokens array requires a `links` property.');
  }

  if (this.options.gfm) {
    if (this.options.breaks) {
      this.rules = inline.breaks;
    } else {
      this.rules = inline.gfm;
    }
  } else if (this.options.pedantic) {
    this.rules = inline.pedantic;
  }
}

/**
 * Expose Inline Rules
 */

InlineLexer.rules = inline;

/**
 * Static Lexing/Compiling Method
 */

InlineLexer.output = function(src, links, options) {
  var inline = new InlineLexer(links, options);
  return inline.output(src);
};

/**
 * Lexing/Compiling
 */

InlineLexer.prototype.output = function(src) {
  var out = ''
    , link
    , text
    , href
    , cap
    , tex
    , esc
    , id
    , alt;

  while (src) {
    // escape
    if (cap = this.rules.escape.exec(src)) {
      src = src.substring(cap[0].length);
      esc = cap[1];
      out += this.renderer.escape(esc);
      continue;
    }

    // math
    if (cap = this.rules.math.exec(src)) {
      src = src.substring(cap[0].length);
      tex = cap[1];
      out += this.renderer.math(tex);
      continue;
    }

    // ref
    if (cap = this.rules.ref.exec(src)) {
      src = src.substring(cap[0].length);
      var args = {};
      argsraw = cap[1];
      args = parseArgs(argsraw);
      out += this.renderer.ref(args);
    }

    // footnote
    if (cap = this.rules.footnote.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.footnote(this.output(cap[1]));
      continue;
    }

    // internal link
    if (cap = this.rules.ilink.exec(src)) {
      src = src.substring(cap[0].length);
      href = cap[1];
      out += this.renderer.ilink(href);
    }

    // autolink
    if (cap = this.rules.autolink.exec(src)) {
      src = src.substring(cap[0].length);
      if (cap[2] === '@') {
        text = cap[1].charAt(6) === ':'
          ? this.mangle(cap[1].substring(7))
          : this.mangle(cap[1]);
        href = this.mangle('mailto:') + text;
      } else {
        text = cap[1];
        href = text;
      }
      out += this.renderer.link(href, null, text);
      continue;
    }

    // url (gfm)
    if (!this.inLink && (cap = this.rules.url.exec(src))) {
      src = src.substring(cap[0].length);
      text = cap[1];
      href = text;
      out += this.renderer.link(href, null, text);
      continue;
    }

    // tag
    if (cap = this.rules.tag.exec(src)) {
      if (!this.inLink && /^<a /i.test(cap[0])) {
        this.inLink = true;
      } else if (this.inLink && /^<\/a>/i.test(cap[0])) {
        this.inLink = false;
      }
      src = src.substring(cap[0].length);
      out += this.options.sanitize
        ? this.options.sanitizer
          ? this.options.sanitizer(cap[0])
          : escape(cap[0])
        : cap[0]
      continue;
    }

    // link
    if (cap = this.rules.link.exec(src)) {
      src = src.substring(cap[0].length);
      this.inLink = true;
      out += this.outputLink(cap, {
        href: cap[2],
        title: cap[3]
      });
      this.inLink = false;
      continue;
    }

    // reflink, nolink
    if ((cap = this.rules.reflink.exec(src))
        || (cap = this.rules.nolink.exec(src))) {
      src = src.substring(cap[0].length);
      link = (cap[2] || cap[1]).replace(/\s+/g, ' ');
      link = this.links[link.toLowerCase()];
      if (!link || !link.href) {
        out += cap[0].charAt(0);
        src = cap[0].substring(1) + src;
        continue;
      }
      this.inLink = true;
      out += this.outputLink(cap, link);
      this.inLink = false;
      continue;
    }

    // strong
    if (cap = this.rules.strong.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.strong(this.output(cap[2] || cap[1]));
      continue;
    }

    // em
    if (cap = this.rules.em.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.em(this.output(cap[2] || cap[1]));
      continue;
    }

    // code
    if (cap = this.rules.code.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.codespan(cap[2].trim());
      continue;
    }

    // br
    if (cap = this.rules.br.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.br();
      continue;
    }

    // del (gfm)
    if (cap = this.rules.del.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.del(this.output(cap[1]));
      continue;
    }

    // text
    if (cap = this.rules.text.exec(src)) {
      src = src.substring(cap[0].length);
      out += this.renderer.text(this.smartypants(cap[0]));
      continue;
    }

    if (src) {
      throw new
        Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }
  }

  return out;
};

/**
 * Compile Link
 */

InlineLexer.prototype.outputLink = function(cap, link) {
  var href = escape(link.href)
    , title = link.title ? escape(link.title) : null;

  return cap[0].charAt(0) !== '!'
    ? this.renderer.link(href, title, this.output(cap[1]))
    : this.renderer.image(href, title, escape(cap[1]));
};

/**
 * Smartypants Transformations
 */

InlineLexer.prototype.smartypants = function(text) {
  if (!this.options.smartypants) return text;
  return text
    // em-dashes
    .replace(/---/g, '\u2014')
    // en-dashes
    .replace(/--/g, '\u2013')
    // opening singles
    .replace(/(^|[-\u2014/(\[{"\s])'/g, '$1\u2018')
    // closing singles & apostrophes
    .replace(/'/g, '\u2019')
    // opening doubles
    .replace(/(^|[-\u2014/(\[{\u2018\s])"/g, '$1\u201c')
    // closing doubles
    .replace(/"/g, '\u201d')
    // ellipses
    .replace(/\.{3}/g, '\u2026');
};

/**
 * Mangle Links
 */

InlineLexer.prototype.mangle = function(text) {
  if (!this.options.mangle) return text;
  var out = ''
    , l = text.length
    , i = 0
    , ch;

  for (; i < l; i++) {
    ch = text.charCodeAt(i);
    if (Math.random() > 0.5) {
      ch = 'x' + ch.toString(16);
    }
    out += '&#' + ch + ';';
  }

  return out;
};

/**
 * Renderer
 */

function DivRenderer(options) {
  this.options = options || {};
}

DivRenderer.prototype.code = function(code, lang, escaped) {
  if (this.options.highlight) {
    var out = this.options.highlight(code, lang);
    if (out != null && out !== code) {
      escaped = true;
      code = out;
    }
  }

  code = escaped ? code : escape(code, true);
  lang = lang ? (this.options.langPrefix + escape(lang, true)) : '';

  return `<div class="code ${lang}">\n${code}\n</div>\n\n`;
};

DivRenderer.prototype.blockquote = function(quote) {
  return `<div class="quote">\n${quote}\n</div>\n\n`;
};

DivRenderer.prototype.html = function(html) {
  return html;
};

DivRenderer.prototype.title = function(text) {
  return `<div class="title">${text}</div>\n\n`;
};

DivRenderer.prototype.heading = function(text) {
  return text;
};

DivRenderer.prototype.envbeg = function(text) {
  return text;
};

DivRenderer.prototype.envend = function(text) {
  return text;
};

DivRenderer.prototype.hr = function() {
  return this.options.xhtml ? '<hr/>\n\n' : '<hr>\n\n';
};

DivRenderer.prototype.list = function(body, ordered) {
  var type = ordered ? 'ordered' : 'unordered';
  return `<div class="list ${type}">\n${body}</div>\n\n`;
};

DivRenderer.prototype.listitem = function(text) {
  return `<div class="list-item">${text}</div>\n`;
};

DivRenderer.prototype.paragraph = function(text, terse) {
  return `<div class="p">${text}</div>\n\n`;
};

DivRenderer.prototype.table = function(header, body) {
  return `<div class="table">\n<div class="table-header">\n${header}</div>\n<div class="table-body">\n${body}</div>\n</div>\n\n`;
};

DivRenderer.prototype.tablerow = function(content) {
  return `<div class="table-row">${content}</div>\n`;
};

DivRenderer.prototype.tablecell = function(content, flags) {
  return `<div class="table-cell">${content}</div>`;
};

// span level DivRenderer
DivRenderer.prototype.strong = function(text) {
  return `<span class="strong">${text}</span>`;
};

DivRenderer.prototype.em = function(text) {
  return `<span class="em">${text}</span>`;
};

DivRenderer.prototype.codespan = function(text) {
  text = escape(text, true);
  return `<span class="code">${text}</span>`;
};

DivRenderer.prototype.br = function() {
  return this.options.xhtml ? '<br/>' : '<br>';
};

DivRenderer.prototype.del = function(text) {
  return `<span class="del">${text}</span>`;
};

DivRenderer.prototype.link = function(href, title, text) {
  if (this.options.sanitize) {
    try {
      var prot = decodeURIComponent(unescape(href))
        .replace(/[^\w:]/g, '')
        .toLowerCase();
    } catch (e) {
      return '';
    }
    if (prot.indexOf('javascript:') === 0 || prot.indexOf('vbscript:') === 0) {
      return '';
    }
  }

  title = title ? `title="${title}"` : '';
  text = escape(text);

  return `<a href="${href}" ${title}>${text}</a>`;
};

DivRenderer.prototype.ilink = function(href) {
  return `<a class="reference pop_anchor" citekey="_ilink_" href="${href}" data-extern='true'>${href}</a>`;
};

DivRenderer.prototype.escape = function(esc) {
  return escape(esc);
};

DivRenderer.prototype.text = function(text) {
  return escape(text);
};

DivRenderer.prototype.math = function(tex) {
  return `<span class="latex">${tex}</span>`;
};

DivRenderer.prototype.equation = function(tex) {
  return `<div class="latex">\n${tex}\n</div>\n\n`;
};

DivRenderer.prototype.ref = function(args) {
  var id = args['id'];
  var ext = id.includes(':');
  var format = args['format'] || args['fmt'] || args['f'] || '';
  var text = args['text'] || args['txt'] || args['t'];
  var htext =  (text != undefined) ? `text="${text}"`: '';
  var pclass = (args['popup'] != 'false') ? 'pop_anchor': '';
  var ptext = ('poptext' in args) ? `poptext="${args['poptext']}"`: '';
  return `<a class="reference ${pclass}" citekey="${id}" data-extern="${ext}" format="${format}" ${htext} ${ptext}></a>`;
};

DivRenderer.prototype.footnote = function(text) {
  return `<span class="footnote pop_anchor" cite_type="footnote" citekey="_self_" pop_text="${text}">&#10218&#8239;<span class=num counter=footnote inc=1></span>&#8239;&#10219</span>`;
};

DivRenderer.prototype.image = function(href, alt) {
  return `<img src="${href}" alt="${alt}">`;
};

DivRenderer.prototype.figure = function(ftype, tag, title, body) {
  var tagtxt = (tag != undefined) ? `id="${tag}"`: '';
  var captxt = (title != undefined) ? `<figcaption>${title}</figcaption>` : '';
  return `<figure class="${ftype}" ${tagtxt}>\n${body}\n${captxt}\n</figure>\n\n`;
};

DivRenderer.prototype.biblio = function(id, info) {
  var keys = '';
  for (k in info) {
    var v = info[k];
    keys += ` ${k}="${v}"`;
  }
  return `<div class="biblio" id="${id}" ${keys}></div>\n`;
};

/**
 * Parsing & Compiling
 */

function Parser(options) {
  this.tokens = [];
  this.token = null;
  this.options = options || marked.defaults;
  this.options.renderer = this.options.renderer || new Renderer;
  this.renderer = this.options.renderer;
  this.renderer.options = this.options;
}

/**
 * Static Parse Method
 */

Parser.parse = function(src, options, renderer) {
  var parser = new Parser(options, renderer);
  return parser.parse(src);
};

/**
 * Parse Loop
 */

Parser.prototype.parse = function(src) {
  this.inline = new InlineLexer(src.links, this.options, this.renderer);
  this.tokens = src.reverse();
  this.env = null;

  var out = '';
  while (this.next()) {
    out += this.tok();
  }

  if (this.options.env) {
    return {'src': out, 'env': this.env};
  } else {
    return out;
  }
};

/**
 * Next Token
 */

Parser.prototype.next = function() {
  return this.token = this.tokens.pop();
};

/**
 * Preview Next Token
 */

Parser.prototype.peek = function() {
  return this.tokens[this.tokens.length - 1] || 0;
};

/**
 * Parse Text Tokens
 */

Parser.prototype.parseText = function() {
  var body = this.token.text;

  while (this.peek().type === 'text') {
    body += '\n' + this.next().text;
  }

  return this.inline.output(body);
};

/**
 * Parse Current Token
 */

Parser.prototype.tok = function() {
  switch (this.token.type) {
    case 'space': {
      return '';
    }
    case 'hr': {
      return this.renderer.hr();
    }
    case 'title': {
      return this.renderer.title(this.inline.output(this.token.text));
    }
    case 'heading': {
      this.env = {
        type: 'env_one',
        env: 'heading',
        args: {
          id: this.token.id,
          level: this.token.depth,
          number: this.token.number
        }
      }
      return this.renderer.heading(
        this.inline.output(this.token.text)
      );
    }
    case 'envbeg': {
      this.env = {
        type: 'env_beg',
        single: this.token.end,
        env: this.token.env,
        args: this.token.args
      };
      return this.renderer.envbeg(
        this.inline.output(this.token.text)
      );
    }
    case 'envend': {
      this.env = {
        type: 'env_end',
        args: {}
      };
      return this.renderer.envend(
        this.inline.output(this.token.text),
      );
    }
    case 'equation': {
      this.env = {
        type: 'env_one',
        env: 'equation',
        args: this.token.args
      }
      return this.renderer.equation(this.token.tex);
    }
    case 'code': {
      return this.renderer.code(this.token.text,
        this.token.lang,
        this.token.escaped);
    }
    case 'table': {
      var header = ''
        , body = ''
        , i
        , row
        , cell
        , flags
        , j;

      // header
      cell = '';
      for (i = 0; i < this.token.header.length; i++) {
        flags = { header: true, align: this.token.align[i] };
        cell += this.renderer.tablecell(
          this.inline.output(this.token.header[i]),
          { header: true, align: this.token.align[i] }
        );
      }
      header += this.renderer.tablerow(cell);

      for (i = 0; i < this.token.cells.length; i++) {
        row = this.token.cells[i];

        cell = '';
        for (j = 0; j < row.length; j++) {
          cell += this.renderer.tablecell(
            this.inline.output(row[j]),
            { header: false, align: this.token.align[j] }
          );
        }

        body += this.renderer.tablerow(cell);
      }

      return this.renderer.table(header, body);
    }
    case 'blockquote_start': {
      var body = '';

      while (this.next().type !== 'blockquote_end') {
        body += this.tok();
      }

      return this.renderer.blockquote(body);
    }
    case 'list_start': {
      var body = ''
        , ordered = this.token.ordered;

      while (this.next().type !== 'list_end') {
        body += this.tok();
      }

      return this.renderer.list(body, ordered);
    }
    case 'list_item_start': {
      var body = '';

      while (this.next().type !== 'list_item_end') {
        body += this.token.type === 'text'
          ? this.parseText()
          : this.tok();
      }

      return this.renderer.listitem(body);
    }
    case 'loose_item_start': {
      var body = '';

      while (this.next().type !== 'list_item_end') {
        body += this.tok();
      }

      return this.renderer.listitem(body);
    }
    case 'html': {
      var html = !this.token.pre && !this.options.pedantic
        ? this.inline.output(this.token.text)
        : this.token.text;
      return this.renderer.html(html);
    }
    case 'paragraph': {
      var nextType = this.peek().type;
      return this.renderer.paragraph(this.inline.output(this.token.text), (nextType == 'equation'));
    }
    case 'text': {
      return this.renderer.paragraph(this.parseText());
    }
    case 'image': {
      return this.renderer.image(this.token.href, this.token.alt);
    }
    case 'figure_start': {
      var ftype = this.token.ftype;
      var tag = this.token.tag;
      var title = this.token.title;
      var body = '';
      while (this.next().type !== 'figure_end') {
        body += this.tok();
      }
      return this.renderer.figure(ftype, tag, title, body);
    }
    case 'biblio': {
      var id = this.token.id;
      delete this.token['type'];
      delete this.token['id'];
      return this.renderer.biblio(id, this.token);
    }
  }
};

/**
 * Helpers
 */

function escape(html, encode) {
  return html
    .replace(!encode ? /&(?!#?\w+;)/g : /&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escape_latex(tex) {
  return tex
    .replace(/#/g, '\\#')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/_/g, '\\_')
    .replace(/\^/g,'\\textasciicircum');
}

function unescape(html) {
  // explicitly match decimal, hex, and named HTML entities
  return html.replace(/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/g, function(_, n) {
    n = n.toLowerCase();
    if (n === 'colon') return ':';
    if (n.charAt(0) === '#') {
      return n.charAt(1) === 'x'
        ? String.fromCharCode(parseInt(n.substring(2), 16))
        : String.fromCharCode(+n.substring(1));
    }
    return '';
  });
}

function replace(regex, opt) {
  regex = regex.source;
  opt = opt || '';
  return function self(name, val) {
    if (!name) return new RegExp(regex, opt);
    val = val.source || val;
    val = val.replace(/(^|[^\[])\^/g, '$1');
    regex = regex.replace(name, val);
    return self;
  };
}

function noop() {}
noop.exec = noop;

function merge(obj) {
  var i = 1
    , target
    , key;

  for (; i < arguments.length; i++) {
    target = arguments[i];
    for (key in target) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        obj[key] = target[key];
      }
    }
  }

  return obj;
}


/**
 * Marked
 */

function marked(src, opt, callback) {
  if (callback || typeof opt === 'function') {
    if (!callback) {
      callback = opt;
      opt = null;
    }

    opt = merge({}, marked.defaults, opt || {});

    var highlight = opt.highlight
      , tokens
      , pending
      , i = 0;

    try {
      tokens = Lexer.lex(src, opt)
    } catch (e) {
      return callback(e);
    }

    pending = tokens.length;

    var done = function(err) {
      if (err) {
        opt.highlight = highlight;
        return callback(err);
      }

      var out;

      try {
        out = Parser.parse(tokens, opt);
      } catch (e) {
        err = e;
      }

      opt.highlight = highlight;

      return err
        ? callback(err)
        : callback(null, out);
    };

    if (!highlight || highlight.length < 3) {
      return done();
    }

    delete opt.highlight;

    if (!pending) return done();

    for (; i < tokens.length; i++) {
      (function(token) {
        if (token.type !== 'code') {
          return --pending || done();
        }
        return highlight(token.text, token.lang, function(err, code) {
          if (err) return done(err);
          if (code == null || code === token.text) {
            return --pending || done();
          }
          token.text = code;
          token.escaped = true;
          --pending || done();
        });
      })(tokens[i]);
    }

    return;
  }
  try {
    if (opt) opt = merge({}, marked.defaults, opt);
    return Parser.parse(Lexer.lex(src, opt), opt);
  } catch (e) {
    e.message += '\nPlease report this to https://github.com/chjj/marked.';
    if ((opt || marked.defaults).silent) {
      return '<p>An error occured:</p><pre>'
        + escape(e.message + '', true)
        + '</pre>';
    }
    throw e;
  }
}

/**
 * Options
 */

marked.options =
marked.setOptions = function(opt) {
  merge(marked.defaults, opt);
  return marked;
};

marked.defaults = {
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: false,
  sanitizer: null,
  mangle: true,
  smartLists: false,
  silent: false,
  highlight: null,
  langPrefix: 'lang-',
  smartypants: false,
  headerPrefix: '',
  renderer: new DivRenderer,
  xhtml: false,
  env: true,
  flatten: false
};

/**
 * Expose
 */

marked.merge = merge;

marked.Parser = Parser;
marked.parser = Parser.parse;

marked.Renderer = DivRenderer;

marked.Lexer = Lexer;
marked.lexer = Lexer.lex;

marked.InlineLexer = InlineLexer;
marked.inlineLexer = InlineLexer.output;

marked.parse = marked;

marked.block = block;

if (typeof module !== 'undefined' && typeof exports === 'object') {
  module.exports = marked;
} else if (typeof define === 'function' && define.amd) {
  define(function() { return marked; });
} else {
  this.markthree = marked;
}

}).call(function() {
  return this || (typeof window !== 'undefined' ? window : global);
}());
