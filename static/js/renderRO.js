/// init commands ///

// inner HTML for para structure. Included here for updating paras
inner_para = `<div class="p_text"></div>`;

getPara = function(pid) {
    return $(`[pid=${pid}]`);
};

unlockParas = null;

$(document).ready(function() {
    var url = `http://${document.domain}:${location.port}`;
    client.connect(url);

    // join room specific to article and get locked paras
    client.sendCommand('room', {'room': aid, 'get_locked': false},);

    $('.para').each(function() {
        var para = $(this);
        para.html(inner_para);

        var raw = para.attr('raw');
        dataToText(para, raw, true); // postpone formatting
        rawToTextArea(para);
    });

    envClasses();
    createRefs();
    setBlurb();
});

/////////////////// EDITING /////////

/// editing commands for paras (triggered by incoming socket commands)
/// local changes only --> to reflect server changes without full reload

// get raw text from data-raw attribute, parse, render
dataToText = function(para, raw, defer=false) {
    // render with markthree
    var mark_out = markthree(raw);
    var html_text = mark_out['src'];
    var env_info = mark_out['env'];

    // store old id/env info
    var old_id = para.attr('id');
    var old_env = para.attr('env');

    // display rendered html
    para.children('.p_text').html(html_text);

    // render math
    renderKatex(para);

    // must remove old classes, to prevent pileup / artifacts
    para.removeClass('env_end')
        .removeClass('env_beg')
        .removeClass('env_one')
        .removeAttr('env')
        .removeAttr('id')
        .removeData('args');

    // fill in env identifiers
    if (env_info != null) {
        if ('env' in env_info) {
            para.attr('env', env_info.env);
        }
        if ('id' in env_info.args) {
            para.attr('id', env_info.args.id);
            delete env_info.args.id;
        }
        para.data('args', env_info.args);

        if (env_info.type == 'env_beg') {
            para.addClass('env_beg');
            if (env_info.single) {
                para.addClass('env_end');
            }
        } else if (env_info.type == 'env_end') {
            para.addClass('env_end');
        } else if (env_info.type == 'env_one') {
            para.addClass('env_one');
        }
    }

    // has id/env info changed?
    var new_id = para.attr('id');
    var new_env = para.attr('env');
    var changeRef = (new_env != old_env) || (new_id != old_id);

    // call environment formatters and reference updates
    if (!defer) {
        envClasses();
        if (changeRef) {
            createRefs(); // we may be able to scope this more
        } else {
            createRefs(para);
        }

        if (old_id && (old_id != new_id)) { // if id changed, and old has not already been assigned
            old_id = para.attr('old_id') || old_id;
            para.attr('old_id', old_id);
        };
    }
};

rawToTextArea = function(para) {
    var textArea = para.children('.p_input');
    var raw = para.attr('raw');
    textArea.val(raw);
};

updateFromTextArea = function(para) {
    var raw = para.children('.p_input').val();
    var pid = para.attr('pid');
    client.sendCommand('update_para', {'pid': pid, 'text': raw});
};

/////////////////// ENVS /////////

// move this to backend when we have user genereted envs

// creates classes for environs
envClasses = function() {
    // remove old env classes
    $('.para > .p_text').removeClass(function(index, css) {
        return (css.match(/(^|\s)env__\S+/g) || []).join(' ');
    });

    // remove env markers
    $('.para').removeClass('env')
              .removeClass('env_err')
              .removeAttr('env_sel');

    // remove formatting addins
    $('.env_add').remove();

    // env state
    var env_name = null;
    var env_id = null;
    var env_args = null;
    var env_paras = [];

    // forward env pass
    $('.para').each(function() {
        var para = $(this);

        if (para.hasClass('env_one')) {
            var ptxt = para.children('.p_text');
            var one_id = para.attr('id');
            var one_env = para.attr('env');
            var one_args = para.data('args');
            para.addClass('env');
            ptxt.addClass(`env__${one_env}`);
            if (one_id != undefined) {
                para.attr('env_sel', `#${one_id}`);
            }
            envFormat(ptxt, one_env, one_args);
        }

        if (!env_name && para.hasClass('env_end') && !para.hasClass('env_beg')) {
            para.addClass('env_err');
            envFormat(para, 'error', {code: 'ending'});
        }

        if (env_name && para.hasClass('env_beg')) { // error on nested environs
            var env_all = $(env_paras);
            var new_env = para.attr('env');
            env_all.addClass('env_err');
            envFormat(env_all, 'error', {code: 'open', env: env_name, new_env: new_env});
        }

        if (env_name && (para.attr('one') == 'heading')) { // sections or headings break envs
            var env_all = $(env_paras);
            env_all.addClass('env_err');
            envFormat(env_all, 'error', {code: 'heading', env: env_name});

            env_name = null;
            env_id = null;
            env_args = null;
            env_paras = [];
        }

        if (!env_name && para.hasClass('env_beg')) { // cannot open an env if one is already open
            env_name = para.attr('env');
            env_id = para.attr('id');
            env_args = para.data('args');
            if (env_id != undefined) {
                para.attr('env_sel', `[env_id="${env_id}"]`);
            }
        }

        if (env_name) {
            env_paras.push(para[0]);
        }

        if (para.hasClass('env_end')) { // closing tag = current open tag
            var env_all = $(env_paras);
            var txt_all = env_all.children('.p_text');
            env_all.addClass('env');
            env_all.attr('env_id', env_id);
            txt_all.addClass(`env__${env_name}`);
            envFormat(txt_all, env_name, env_args);

            env_name = null;
            env_id = null;
            env_args = null;
            env_paras = [];
        }
    });

    // add error for open envs left at the end
    if (env_name) {
        var env_all = $(env_paras);
        env_all.addClass('env_err');
        envFormat(env_all, 'error', {code: 'eof', env: env_name});
    }

    // add in numbers with auto-increment
    createNumbers();
};

envFormat = function(paras, env, args) {
    if (env in env_spec) {
        env_spec[env](paras, args);
    } else {
        var args = {code: 'undef', env: env};
        env_spec.error(paras, args);
    }
}

//// ENV formatting

makeCounter = function(env, inc=1) {
    return $('<span>', {class: 'num', counter: env, inc: inc});
}

simpleEnv = function(ptxt, env, head='', tail='', num=false) {
    var first = ptxt.first();
    var pre = $('<span>', {class: `env_add ${env}_header`, html: head});
    if (num) {
        var span = makeCounter(env);
        pre.append([' ', span]);
    }
    pre.append('. ');
    first.prepend(pre);

    var last = ptxt.last();
    var pos = $('<span>', {class: `env_add ${env}_footer`, html: tail});
    pos.prepend(' ');
    last.append(pos);
};

// we probably want to pass targ as an argument
errorEnv = function(ptxt, args) {
    var mesg;
    var targ;

    if (args.code == 'undef') {
        mesg = `Error: envrionment ${args.env} is not defined.`;
        targ = ptxt.first();
    } else if (args.code == 'open') {
        mesg = `Error: envrionment ${args.env} not closed at new environment ${args.new_env}.`;
        targ = ptxt.first();
    } else if (args.code == 'heading') {
        mesg = `Error: envrionment ${args.env} not closed at end of section.`;
        targ = ptxt.first();
    } else if (args.code == 'eof') {
        mesg = `Error: envrionment ${args.env} not closed at end of document.`;
        targ = ptxt.last();
    } else if (args.code == 'ending') {
        mesg = `Error: environment ending when not in environment.`;
        targ = ptxt.first();
    }

    var pre = $('<div>', {class: 'env_add error_footer', html: mesg});
    ptxt.append(pre);
};

numberEnv = function(ptxt, env, head='', tail='', args={}) {
    var num = args.number || '';
    return simpleEnv(ptxt, env, head, tail, num);
};

theoremEnv = function(ptxt, args) {
    return numberEnv(ptxt, 'theorem', 'Theorem', '—', args);
};

proofEnv = function(ptxt, args) {
    return simpleEnv(ptxt, 'proof', 'Proof', `— <span class='qed'>&#8718;</span>`, false);
};

exampleEnv = function(ptxt, args) {
    return numberEnv(ptxt, 'example', 'Example', '', args);
};

headingEnv = function(ptxt, args) {
    ptxt.addClass(`env__heading_h${args.level}`);
    ptxt.attr('head_level', args.level)
    var num = $('<span>', {class: 'env_add'});
    if (args.number) {
        l = 1;
        while (args.level - l) {
            num.append(makeCounter(`heading${l}`, 0));
            num.append('.');
            l += 1;
        }
        num.append(makeCounter(`heading${l}`, 1));
    }
    ptxt.prepend([num, ' ']);
};

equationEnv = function(ptxt, args) {
    if (args.number) {
        var num = makeCounter('equation');
        var div = $('<div>', {class: 'env_add eqnum'});
        div.append(['(', num, ')']);
        ptxt.append(div);
    }
};

env_spec = {
    'theorem': theoremEnv,
    'proof': proofEnv,
    'example': exampleEnv,
    'heading': headingEnv,
    'equation': equationEnv,
    'error': errorEnv,
};

//// KATEX

renderKatex = function(para) {
    para.find('span.latex').each(function() {
        var tex = $(this);
        var src = tex.text();
        tex.empty();
        try {
          katex.render(src, tex[0],
            //{macros: config["macros"]}
            );
        } catch (e) {
          console.log(para.text());
          console.log(src);
          console.log(e);
        }
    });
    para.find('div.latex').each(function() {
        var tex = $(this);
        var src = tex.text();
        $(this).empty();
        try {
            katex.render(src, tex[0], {displayMode: true,
                //macros: config["macros"]
            });
        } catch (e) {
            console.log(para.text());
            console.log(src);
            console.log(e);
        }
    });

};

/// Numbering and TOC

createNumbers = function() {
    var nums = {};
    $('.num').each(function() {
        var counter = $(this).attr('counter');
        var inc = parseInt($(this).attr('inc'));
        nums[counter] = nums[counter] || 0;
        nums[counter] += inc;
        $(this).text(nums[counter]);
    });
    createTOC();
};

createTOC = function() {
    toc = $('#toc');
    toc.find('.toc_entry').remove();
    $('.env__heading').each(function() {
        let level = $(this).attr('head_level')
        let text = $(this).text();
        let id = $(this).parent('.para').attr('id');
        let sec = id
            ? $('<a>', {class: `toc_entry head_level${level}`, href: '#'+id, text: text})
            : $('<span>', {class: `toc_entry head_level${level}`, text: text});
        toc.append(sec);
    });
};



/// REFERENCING and CITATIONS

// renderedCites = new Set(); // state var, citations previously rendered

createRefs = function(para) {
    var refs;
    if (para == undefined) {
        refs = $('.reference');
    } else {
        refs = para.find('.reference');
    }

    // get citations
    var citeKeys = new Set();
    refs.each(function() {
        var ref = $(this);
        if (!ref.data('extern')) {
            var key = ref.attr('citekey');
            if (($('#'+key).length == 0) && (key != '_self_')) {
                citeKeys.add(key);
            };
        };
    });

    // will only require server interaction for novel citations
    //since we are not displaying refrences we dont need this bit either, i think
    // var unRenderedCites = [];
    // for (let key of citeKeys) {
    //     if (!renderedCites.has(key)) {
    //         unRenderedCites.push(key);
    //     }
    // }

    /*
    // skipping this shouldn't kill us, and saves some redundant passes
    // remove old bib entries that have been removed
    for (let key of renderedCites) {
        if (!citeKeys.has(key)) {
            $('#'+key).remove();
        }
    }
    */

    // communicate results to server
    // if (unRenderedCites.length > 0) {
    if (citeKeys.size > 0) {
        client.sendCommand('get_cite', {'keys': [...citeKeys]}, function(response) {
            renderBibLocal(response);
            renderCiteText(para);
        });
    } else {
        renderCiteText(para);
    }

    //renderedCites = citeKeys;
};

getTro = function(ref, callback) {
    //var ref = $(this); // the reference (actually an 'a' tag)
    var text = ref.attr('text') || '';

    var tro = {};
    var key = ref.attr('citekey');

    if (key == '_self_') {
        tro.tro = ref;
        tro.cite_type = 'self';
        callback(ref, tro, text);
    } else if (key == '_ilink_') {
        client.sendCommand('get_blurb', ref.attr('href'), function(response) {
            if (response) {
                tro.tro = response;
                tro.cite_type = 'ilink';
            } else {
                tro.tro = '';
                tro.cite_type = 'err';
                tro.cite_err = 'not_found';
            }
            tro.cite_type = 'ilink';
            callback(ref, tro, text, true);
        });
    } else if (ref.data('extern')) {
        var [extern, citekey] = key.split(':');
        client.sendCommand('get_ref', {'title': extern, 'key': citekey}, function(data) {
            tro.tro = $($.parseHTML(data.text));
            tro.cite_type = data.cite_type;
            tro.cite_env = data.cite_env;
            callback(ref, tro, text, data.title);
        });
    } else {
        tro = troFromKey(key, tro);
        callback(ref, tro, text);
    }
};

troFromKey = function(key, tro={}) {
    tro.id = key;
    tro.tro = $('#'+key); // the referenced object
    if (tro.tro != undefined) {
        if (tro.tro.hasClass('env_beg') || tro.tro.hasClass('env_one')) {
            if (tro.tro.hasClass('env_err')) {
                tro.cite_type = 'err';
                tro.cite_err = 'parse_error';
            } else {
                tro.cite_type = 'env';
                tro.cite_env = tro.tro.attr('env');
                tro.cite_sel = tro.tro.attr('env_sel');
            }
        } else if (tro.tro.hasClass('cite')) {
            tro.cite_type = 'cite';
        } else {
            tro.cite_type = 'err';
            tro.cite_err = 'unknown_type';
        }
    } else {
        tro.cite_type = 'err';
        tro.cite_err = 'not_found';
    }
    return tro;
};

renderCiteText = function(para) {
    var refs;
    if (para == undefined) {
        refs = $('.reference');
    } else {
        refs = para.find('.reference');
    }

    refs.each(function() {
        var r = $(this);
        getTro(r, renderRef);
    });

    /*
    // keeping refs hidden, only used for popups
    if ($('.cite').length > 0) {
        $('#bib_block').show();
    } else {
        $('#bib_block').hide();
    }
    */
};

// routing is split due to aysc of sever commands
renderRef = function(ref, tro, text, ext) {
    if (text.length > 0) {
        ref_spec.text(ref, tro.tro, text);
    } else if (tro.cite_type == 'self') {
        ref_spec.self(ref);
    } else if (tro.cite_type == 'env') {
        if (tro.cite_env in ref_spec) {
            ref_spec[tro.cite_env](ref, tro.tro, ext=ext);
        } else {
            ref_spec.error(ref);
        };
    } else if (tro.cite_type == 'cite') {
        ref_spec.cite(ref, tro.tro);
    } else if (tro.cite_type == 'err') {
        ref_spec.error(ref);
    };
};

refCite = function(ref, tro) {
    var authors = tro.attr('authors').split(',');
    var year = tro.attr('year');
    var format = ref.attr('format') || '';
    var href = '#' + tro.attr('id');

    if (authors.length == 2) {
        citeText = `${authors[0]} and ${authors[1]}`;
    } else if (authors.length < 2) {
        citeText = authors[0];
    } else {
        citeText = `${authors[0]} et al.`;
    }

    if (format == 'p') {
        citeText = `(${citeText}, ${year})`;
    } else {
        citeText += ` (${year})`;
    }

    ref.text(citeText);
    ref.attr('href', href);
};

refEquation = function(ref, tro, ext) {
    var num = tro.find('.num')[0];
    var text = $(num).text();
    var citeText = (ext) ? `(${ext}, Eq. ${text})` :`(${text})`;
    var href = '#' + tro.attr('id');
    ref.text(citeText);
    ref.attr('href', href);
};

refEnv = function(ref, tro, env, ext) {
    var format = ref.attr('format') || '';
    var num = tro.find('.num')[0];
    var text = $(num).text();
    var href = '#' + tro.attr('id');

    var citeText;
    if (format == 'plain') {
        citeText = text;
    } else {
        citeText = `${env} ${text}`;
    }

    if(ext){
        citeText += ` (${ext})`
    }

    ref.text(citeText);
    ref.attr('href', href);
    // ref.removeClass('pop_anchor') // just for now
};

refText = function(ref, tro, text) {
    var href = '#' + tro.attr('id');

    ref.text(text);
    ref.attr('href', href);
};

refError = function(ref) {
    var href = ref.attr('citekey') || '';
    ref.html(`<span class="ref_error">@[${href}]</span>`);
};

refSection = function(ref, tro, ext) {
    refEnv(ref, tro, 'Section', ext);
};

refTheorem = function(ref, tro, ext) {
    refEnv(ref, tro, 'Theorem', ext);
};

refSelf = function(ref) {
    var text = ref.attr('text');
    ref.text(text);
};

ref_spec = {
    'cite': refCite,
    'self': refSelf,
    'error': refError,
    'equation': refEquation,
    'heading': refSection,
    'theorem': refTheorem,
    'text': refText,
};

/// THIS IS REPATED FROM THE BIB.JS, we should make it more efficent

renderBibLocal = function(data){
    // $('#para_holder').empty();
    data.map(createBibEntry);
}

createBibEntry = function(cite) {
    $('#'+cite['citekey']).remove();

    var yr = cite['year'] ? ` ${cite['year']}. ` : '';
    var vol = cite['volume'] ? `, ${cite['volume']}` : '';
    var num = cite['number'] ? `, no. ${cite['number']}` : '';
    var pgs = cite['pages'] ? `, pp. ${cite['pages']}` : '';
    var title = cite['title'] ? `${cite['title']}` : '';
    var pubs = ['book', 'incollection'];
    var jns = ['article', 'techreport', 'unpublished'];

    var pub;
    var journal;
    if (pubs.includes(cite['entry_type'])) {
        pub = cite['publisher'] || '';
        journal = (cite['booktitle']) ? `In ${cite['booktitle']}`: '';
    } else if (jns.includes(cite['entry_type'])) {
        pub = '';
        journal = cite['journal'] || 'mimeo';
    }

    var author = `<b>${cite['author']}</b>. ` || '';
    var index = (vol || num || pgs) ? `${vol + num + pgs}.` : '';

    var author_list = cite['author'].split(' and ').map(auth => auth.split(',')[0]);

    $('#bib_block').append(
        `<div class="cite" id=${cite['citekey']} cite-type="cite" authors="${author_list}" year="${cite['year']}">
        <span class="citeText">
        ${author}${yr}${title}. <em>${journal}</em>${index} ${pub}
        </span>
        <span class="citekey">${cite['citekey']}</span>
        </div>`
    );
};

//// POPUP FUNCTIONALITY

$(document).on({
    mouseenter: function() {
        var ref = $(this);
        ref.data('show_pop', true);
        var html = getTro(ref, renderPop);
    },
    mouseleave: function() {
        var ref = $(this);
        ref.data('show_pop', false);
        $('#pop').remove();
        $(window).unbind('mousemove')
    },
}, '.pop_anchor');

createPop = function(html='') {
    var pop = $('<div>', {id: 'pop'});
    pop.html(html);
    $('#bg').append(pop);

    h = pop.height();
    w = pop.width();

    $(this).mousemove(function(event) {
        pop.css({
            'left': (event.pageX - 0.5*w - 10) + 'px', // offset 10px for padding
            'top': (event.pageY - h - 35) + 'px', // offset up by 35 px
        });
    });
};

// generates pop text from tro (only for internal refs)
popText = function(tro) {
    if (tro.cite_type == 'self') {
        return pop_spec.self(tro.tro);
    } else if (tro.cite_type == 'env') {
        if (tro.cite_env in pop_spec) {
            var paras = $(tro.cite_sel);
            return pop_spec[tro.cite_env](paras);
        } else {
            return pop_spec.error('not_found');
        }
    } else if (tro.cite_type == 'cite') {
        return pop_spec.cite(tro.tro);
    } else if (tro.cite_type == 'err') {
        return pop_spec.error(tro.cite_err);
    }
};

renderPop = function(ref, tro, text, ext) {
    if (!ref.data('show_pop')) { // we've since left with mouse
        return;
    }
    if (ext != undefined) {
        pop = tro.tro;
    } else {
        var pop = popText(tro);
    };
    createPop(pop);
}

popError = function(err='not_found') {
    if (err == 'not_found') {
        return "[Reference Not Found]";
    } else if (err == 'env_err') {
        return "[Referenced Environment Not Closed]";
    } else {
        return "[Error]";
    }
};

popSection = function(tro) {
    return tro.children('.p_text').text();
};

popEquation = function(tro) {
    return tro.children('.p_text').html();
};

popCite = function(tro) {
    return tro.find('.citeText').html();
};

popSelf = function(tro) {
    return tro.attr('pop_text');
};

popEnv = function(tro) {
    var html = '';
    tro.each(function() {
        var ptxt = $(this).children('.p_text');
        html += ptxt.html();
    });

    return html;
};

pop_spec = {
    'heading': popSection,
    'theorem': popEnv,
    'cite': popCite,
    'equation': popEquation,
    'footnote': popSelf,
    'self': popSelf,
    'error': popError,
};


/// External References

createExtRef = function(id) {
    var tro = troFromKey(id);
    var ref = {};
    ref.aid = aid;
    ref.key = id;
    ref.cite_type = tro.cite_type;
    ref.cite_env = tro.cite_env;
    ref.text = popText(tro);
    return ref;
};

updateRefHTML = function(para) {
    var new_id = para.attr('id') || para.attr('env_id');
    var old_id = para.attr('old_id');

    if (new_id) {
        var ref = createExtRef(new_id);
        client.sendCommand('update_ref', ref, function(success) {
            console.log('success');
        });
    }

    if (old_id && ($('#'+old_id).length > 0)) {
        var ref = createExtRef(old_id);
        client.sendCommand('update_ref', ref, function(success) {
            console.log('success');
        });
    }
};

$.fn.ignore = function(sel) {
    return this.clone().find(sel || '>*').remove().end();
};

getBlurb = function(len=200) {
    var blurb = '';
    var size = 0;
    $('.para').each(function() {
        var para = $(this);
        var ptxt = para.children('.p_text');
        var core = ptxt.ignore('.katex-mathml, .eqnum')
                       .removeClass('p_text');

        var html = core[0].outerHTML;
        blurb += html + ' ';

        var text = core.text();
        size += text.length;

        if (size > len) {
            blurb += '...';
            return false;
        }
    });
    return blurb;
};

setBlurb = function() {
    var blurb = getBlurb();
    client.sendCommand('set_blurb', {'aid': aid, 'blurb': blurb}, function(success) {
            console.log('blurb set');
        });
}


/// SIDEBAR


// default options
default_theme = theme;

// current options
current_theme = 'default';
current_font = 'default';

themeLink = function(name) {
    return $('<link>', {
        id: 'theme',
        type: 'text/css',
        rel: 'stylesheet',
        href: `/static/themes/${name}.css`,
    });
};

$(document).ready(function() {
$('#logo').click(function() {
    console.log('click')
    $('#sidebar').animate({width: 'toggle'}, 100);
});

$('#theme_select').change(function() {
    var tselect = $(this);
    var tchoice = tselect.children('option:selected').text();
    if (tchoice != current_theme) {
        current_theme = tchoice;
        var tset = (tchoice == 'default') ? default_theme : tchoice;
        $('#theme').remove();
        var link = themeLink(tset);
        $('head').append(link);
    }
});

$('#font_select').change(function() {
    var fselect = $(this);
    var fchoice = fselect.children('option:selected').text();
    if (fchoice != current_font) {
        current_font = fchoice;
        var fset = (fchoice == 'default') ? '' : fchoice;
        $('#content').css('font-family', fset);
    }
});
});

//SELECT

$(document).ready(function() {
$(".custom-select").each(function() {
  var classes = $(this).attr("class"),
      id      = $(this).attr("id"),
      name    = $(this).attr("name");
  var template =  '<div class="' + classes + '">';
      template += '<span class="custom-select-trigger">' + $(this).attr("placeholder") + '</span>';
      template += '<div class="custom-options">';
      $(this).find("option").each(function() {
        template += '<span class="custom-option ' + $(this).attr("class") + '" data-value="' + $(this).attr("value") + '">' + $(this).html() + '</span>';
      });
  template += '</div></div>';
  
  $(this).wrap('<div class="custom-select-wrapper"></div>');
  $(this).hide();
  $(this).after(template);
});
$(".custom-option:first-of-type").hover(function() {
  $(this).parents(".custom-options").addClass("option-hover");
}, function() {
  $(this).parents(".custom-options").removeClass("option-hover");
});
$(".custom-select-trigger").on("click", function() {
  $('html').one('click',function() {
    $(".custom-select").removeClass("opened");
  });
  $(this).parents(".custom-select").toggleClass("opened");
  event.stopPropagation();
});
$(".custom-option").on("click", function() {
  $(this).parents(".custom-select-wrapper").find("select").val($(this).data("value"));
  $(this).parents(".custom-options").find(".custom-option").removeClass("selection");
  $(this).addClass("selection");
  $(this).parents(".custom-select").removeClass("opened");
  $(this).parents(".custom-select").find(".custom-select-trigger").text($(this).text());
});
});

/// Exporting

getMarkdown = function() {
    return $('.para').map(function() {
        var para = $(this);
        return para.attr('raw');
    }).toArray().join('\n\n');
};
