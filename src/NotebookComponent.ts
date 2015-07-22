///<reference path="../components/phosphor/dist/phosphor.d.ts"/>

/* TODO:

For executing, need:

* kernelselector
* session
* kernel
* comm


*/

declare var gapi;


import nbformat = require("./nbformat");
import mathjaxutils = require("./mathjaxutils");
import DOM = phosphor.virtualdom.dom;
import Component = phosphor.virtualdom.Component;
import BaseComponent = phosphor.virtualdom.BaseComponent;
import Elem = phosphor.virtualdom.Elem;
import createFactory = phosphor.virtualdom.createFactory;
import render = phosphor.virtualdom.render;
import IMessage = phosphor.core.IMessage;

var div = DOM.div;
var pre = DOM.pre;
var img = DOM.img;

class MimeBundleComponent extends Component<nbformat.MimeBundle> {
  render() {
    // possible optimization: iterate through
    var x: string | string[];
    if (x = this.data["image/png"]) {
      return img({src:"data:image/png;base64,"+x})
    } else if (x = this.data["image/jpg"]) {
      return img({src:"data:image/jpg;base64,"+x})
    } else if (x = this.data["text/plain"]) {
      return pre(x);
    }
  }
}
export var MimeBundle = createFactory(MimeBundleComponent);

class ExecuteResultComponent extends Component<nbformat.ExecuteResult> {
  render() {
    return MimeBundle(this.data.data);
  }
}
export var ExecuteResult = createFactory(ExecuteResultComponent);

class DisplayDataComponent extends Component<nbformat.DisplayData> {
  render() {
    return MimeBundle(this.data.data);
  }
}
export var DisplayData = createFactory(DisplayDataComponent);

class StreamComponent extends Component<nbformat.Stream> {
  render() {
    return pre(this.data.text);
  }
}
export var Stream = createFactory(StreamComponent);

class JupyterErrorComponent extends Component<nbformat.JupyterError> {
  render() {
    var o = this.data;
    return pre(o.ename+'\n'+o.evalue+'\n'+(o.traceback.join('\n')));
  }
}
export var JupyterError = createFactory(JupyterErrorComponent)

// customized renderer example from marked.js readme
var renderer = new (<any>marked).Renderer();
renderer.heading = function (text: string, level: number) {
  var escapedText = text.toLowerCase().replace(/[^\w]+/g, '-');
  return `<h${level} id="${escapedText}">${text}<a class="anchor-link" href="#${escapedText}">¶</a></h${level}>`;
}

renderer.unescape = function(html: string): string {
  // from https://github.com/chjj/marked/blob/2b5802f258c5e23e48366f2377fbb4c807f47658/lib/marked.js#L1085
  return html.replace(/&([#\w]+);/g, function(_, n) {
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

renderer.check_url = function(href: string): boolean {
    try {
        var prot = decodeURIComponent(this.unescape(href))
            .replace(/[^\w:]/g, '')
            .toLowerCase();
    } catch (e) {
        return false;
    }
    if (prot.indexOf('javascript:') === 0 || prot.indexOf('vbscript:') === 0) {
        return false;
    }
    return true;
};

renderer.link = function(href: string, title: string, text: string) {
    //modified from the mark.js source to open all urls in new tabs
    if (this.options.sanitize && !this.check_url(href)) {
        return '';
    }
    return `<a href="${href}" ${title ? `title="${title}"` : ""} ${href[0] !== "#" ? "target=_blank" : ""}>${text}</a>`;
};

/**
 * get the absolute cursor position from CodeMirror's col, ch
 */
var toAbsoluteCursorPosition = function(cm:any, cursor:any):number {
    var cursor_pos = cursor.ch;
    for (var i = 0; i < cursor.line; i++) {
        cursor_pos += cm.getLine(i).length + 1;
    }
    return cursor_pos;
};

export interface LC {
  line:number
  ch:number
}
export interface FromTo {
  from:LC
  to:LC
}

/**
 * turn absolute cursor position into CodeMirror col, ch cursor
 */
var fromAbsoluteCursorPos = function (cm:any, cursor_pos:number):LC {
  var i:number, line, next_line;
  var offset = 0;
  for (i = 0, next_line=cm.getLine(i); next_line !== undefined; i++, next_line=cm.getLine(i)) {
      line = next_line;
      if (offset + next_line.length < cursor_pos) {
          offset += next_line.length + 1;
      } else {
          return {
              line : i,
              ch : cursor_pos - offset,
          };
      }
  }
  // reached end, return endpoint
  return {
      line : i - 1,
      ch : line.length - 1,
  };
};

class MarkdownCellComponent extends BaseComponent<nbformat.MarkdownCell> {
  onUpdateRequest(msg: IMessage): void {
    // replace the innerHTML of the node with the rendered markdown
    //var t = mathjaxutils.remove_math(this.data.source);
    var t = mathjaxutils.remove_math('foobar');
    marked(t.html, { sanitize: true, renderer: renderer}, (err: any, html: string) => {
        this.node.innerHTML = mathjaxutils.replace_math(html, t.math);
        // TODO: do some serious sanitization, using, for example, the caja sanitizer
        MathJax.Hub.Queue(["Typeset", MathJax.Hub, this.node]);
    });
  }
}
export var MarkdownCell = createFactory(MarkdownCellComponent)

/**
 * factory for codemirror's callback on add and on delete
 * that shoudl be triggers by the model. Need options not
 * to ignore local change in soem case.
 **/
 // TODO, the event is still a GoogleRT event.
 // wrap it in our own implementation.
var on_add = function(cm, ignore_local=true){
    return function(evts){
        if(evts.isLocal && ignore_local){
            return
        }
        var str = evts.text;
        var from = fromAbsoluteCursorPos(cm, evts.index)
        var to = from;
        cm.getDoc().replaceRange(str, from, to, '+remote_sync');
    }
};

/**
 * factory for codemirror's callback on add and on delete
 * that shoudl be triggers by the model. Need options not
 * to ignore local change in soem case.
 **/
 // TODO, the event is still a GoogleRT event.
 // wrap it in our own implementation.
var on_del = function(cm, ignore_local=true){
    return function(evts){
        if(evts.isLocal && ignore_local){
            return
        }
        var from = fromAbsoluteCursorPos(cm, evts.index);
        var to   = fromAbsoluteCursorPos(cm, evts.index+evts.text.length);
        cm.getDoc().replaceRange('', from, to, '+remote_sync');
    }
};

/**
 * We inherit from BaseComponent so that we can explicitly control the rendering.  We want to use the virtual dom to render
 * the output, but we want to explicitly manage the code editor.
*/
class CodeCellComponent extends BaseComponent<nbformat.CodeCell> {

  constructor(data: nbformat.CodeCell, children: Elem[]) {
    super(data, children);
    this.editor_node = document.createElement('div');
    this.editor_node.classList.add("ipy-input")
    this.output_node = document.createElement('div');
    this.node.appendChild(this.editor_node);
    this.node.appendChild(this.output_node);
    
    var source = <MaybeCollaborativeString>(<any>this.data.source);
    this._editor  = CodeMirror(this.editor_node, {
      mode: 'python',
      value: source.value(),
      lineNumbers: true});
    var that = this;
    
    // change tha to changes at some point that are triggerd
    // in batch operation. That shoudl make a difference for
    // combining changes like commenting.
    this._editor.on('change', (cm, change) => {
        console.log("[NotebookComponent] handeling change of type", change.origin)
        if(change.origin === 'setValue'){
          return
        }
        // need to handle paste
        if(change.origin === '+input' || change.origin === 'paste' || change.origin === '*compose'){
            var index = toAbsoluteCursorPosition(cm, change.from)
            // handle insertion of new lines.
            //
            var text = change.text[0];
            if(change.text.length == 2){
                text = change.text.join('\n');
            }
            // if htere is a to != from than we need to trigger a delete. first.
            var indexto = toAbsoluteCursorPosition(cm, change.to)
            if(index != indexto){
              source.deleteRange(index, indexto)
            }
            source.insert(index, text)
          } else if (change.origin == '+delete'){
              var startIndex = toAbsoluteCursorPosition(cm, change.from);
              var endIndex = toAbsoluteCursorPosition(cm, change.to);
              source.deleteRange(startIndex, endIndex);
          } else if (change.origin === '+remote_sync'){
            var len= change.text.reduce(function(s, next) {
                return s + next.length;
            }, 0);
              this._editor.getDoc().markText({line:change.from.line, ch:change.from.ch},
                                         {line:change.to.line, ch:change.to.ch+1+len}, {css:'background-color: #DDF;', title:'Nyan Cat cursor'})
          } else {
            console.log("[NotebookComponent] Non known change, not updating model to avoid recursive update", change)
          }
    });
    
    source.oninsert(on_add(this._editor) );
    source.ondelete(on_del(this._editor) );
  }





  protected onUpdateRequest(msg: IMessage): void {
    // we could call setValue on the editor itself, but the dts file doesn't recognize it.
    this._editor.getDoc().setValue((<MaybeCollaborativeString>(<any>this.data.source)).value());
    this._editor.getDoc().markText({line:0, ch:7}, {line:0, ch:9}, {css:'color: red; border:thin solid blue;', title:'Nyan Cat cursor'})
    // we may want to save the refs at some point
    render(this.renderOutput(), this.output_node);
  }

  protected onAfterAttach(msg: IMessage): void {
    this._editor.refresh();
  }
  renderOutput(): Elem[] {
    var r: Elem[] = [];
    var outputs: nbformat.Output[] = this.data.outputs;
    for(var i = 0; i < outputs.length; i++) {
      var x = outputs[i];
      switch(x.output_type) {
        case "execute_result":
          r.push(ExecuteResult(<nbformat.ExecuteResult>x));
          break;
        case "display_data":
          r.push(DisplayData(<nbformat.DisplayData>x));
          break;
        case "stream":
          r.push(Stream(<nbformat.Stream>x));
          break;
        case "error":
          r.push(JupyterError(<nbformat.JupyterError>x));
          break;
      }
    }
    return r;
  }

  editor_node: HTMLElement;
  output_node: HTMLElement;
  _editor: CodeMirror.Editor;
}
export var CodeCell = createFactory(CodeCellComponent);

export class MaybeCollaborativeString {
  _origin:any
  constructor(origin:any){
    this._origin = origin
  }
  
  value():string{
    if(this.rt){
      return this._origin.getText()
    } else {
      return this._origin
    }
  }
  
  get rt():boolean{
    return (this._origin.addEventListener !== undefined)
  }
  
  oninsert(callback:(evt)=>void):void{
    if(this.rt){
      this._origin.addEventListener(gapi.drive.realtime.EventType.TEXT_INSERTED, callback)
    }
  }
  
  ondelete(callback:(evt)=>void):void{
    if(this.rt){
      this._origin.addEventListener(gapi.drive.realtime.EventType.TEXT_DELETED, callback)
    }
  }
  
  insert(index:number, text:string):void{
    if(this.rt){
      this._origin.insertString(index, text)
    }
  }
  
  deleteRange(from:number, to:number):void{
    if(this.rt){
        this._origin.removeRange(from, to)
    }
  }
  
}

class CellAcessor implements nbformat.BaseCell{
  _thing;
  constructor(thing:any){
    this._thing = thing
  }
  
  get cell_type():string{
    return this._thing.cell_type||this._thing.get('cell_type')
  }
  
  get metadata():Object{
    return this._thing.metadata||this._thing.get('metadata')
  }
  
  get source():any{
    if (this._thing.get !== undefined){
      return new MaybeCollaborativeString(this._thing.get('source'))
    } else {
      return new MaybeCollaborativeString(this._thing.source || 'default source')
    }
  }
  
  get outputs(){
    return this._thing.output ||[]
  }

}


class NotebookComponent extends Component<nbformat.INotebookInterface> {
  render() {
    console.info("[NotebookComponent] rendering notebook...")
    var cells = this.data.cells;
    var r: Elem[] = [];
    for(var i = 0; i < cells.count; i++) {
      var c = <any>(new CellAcessor(cells.get(i)));
      switch(c.cell_type) {
        case "code":
          r.push(CodeCell(<nbformat.CodeCell>c));
          break;
        case "markdown":
          r.push(MarkdownCell(<nbformat.MarkdownCell>c));
          break;
        }
    }
    return r;
  }
}
export var Notebook = createFactory(NotebookComponent);
