// ==========================================================================
// Project:   SproutCore - Upload
// Copyright: ©2011 7x7 Software Inc. and contributors.
// License:   Licensed under MIT license
// ==========================================================================

/** @class

  Implements a customized file input by creating a transparent file type input over top of a
  SC.ButtonView and using a hidden iframe to receive results (simulated AJAX).

  There is only one caveat to using SC.FileFieldView unmodified, which is, on completion of the
  file load, the server must return a plain/text document containing stringified JSON.
  SC.FileFieldView will parse the document (assuming it's plain/text) and pass the resulting
  JSON object to its delegate.

  @extends SC.View
  @since SproutCore 1.0
*/

// TODO: send warnings if the protocol isn't supported and try not to just hang
SC.FileFieldView = SC.View.extend(SC.DelegateSupport, {
  classNames: 'sc-file-field-view'.w(),

  /**
    The height of the buttons.

    @property {Number}
    */
  buttonHeight: 24,

  /**
    The width of the buttons.

    @property {Number}
    */
  buttonWidth: 110,

  /**
    The title of the button.

    @property {String}
    */
  buttonTitle: 'Choose File',

  /**
    The theme of the button. See SC.ButtonView.

    @property {String}
    */
  buttonThemeName: 'capsule',

  /**
    The title of the button after the input has a selection.  Setting this to null, will use the buttonTitle property instead.

    @property {String}
    */
  fileSelectedButtonTitle: "Change",

  /**
    Control HTML escaping of the button title and filename labels.

    WARNING: HTML escaping is turned off by default, to properly display horizontal ellipses &hellip;.

    @property {Boolean}
    */
  escapeHTML: NO,

  /**
    The placeholder text to the right of the button when the input has no selection.

    @property {String}
    */
  emptyText: "no file selected",

  /**
    By default, SC.FileFieldView shows the name of the selected file to the right of the button, set
    this to NO to not display anything.

    @property {Boolean}
    */
  displaysSelectedFilename: YES,

  /**
    The submit action for the form.  This should be the path to your server's upload handler.

    @property {String}
    */
  formAction: '',

  /**
    The name attribute for the file input(s).  The default value creates an input as such:
      <input type="file" name="files[]" ...

    @property {String}
    */
  inputName: 'files[]',

  /**
     The list of key-value pairs to be added as hidden values to submit along with the POST.
     These will be rendered hidden in the form.

     Example:
       { key: "cookie", value: "abcdefghijklmnopqrstuvwxyz" }

     @property {Array}
   */
  hiddenInputs: null,

  /**
    Upload the file(s) automatically when set.  If numberOfFiles > 1, then the form won't be submitted until all inputs have values.

    @property {Boolean} YES, to autosubmit when all of the inputs have a value
    */
  autoSubmit: YES,

  /**
    The maximum number of file uploads.  A value greater than one will create multiple file inputs or set the HTML5 'multiple' attribute for a single input in browsers that support it.

    TODO: add the multiple attribute code per browser

    @property {Number}
    */
  numberOfFiles: 1,

  /**
    NOTE: This property only applies if numberOfFiles > 1

    Show additional file upload buttons progressively as each is assigned a value.  If isProgressive is NO, then
    all of the file upload buttons (matching numberOfFiles) will be visible.

    @property {Boolean}
    */
  isProgressive: YES,

  /**
    Submits the form and returns the unique X-Progress-ID that was submitted with the files.  If your backend is configured to track file uploads, such as with mod_upload_progress for lighttpd or NginxHttpUploadProgressModule, this X-Progress-ID can be used to periodically query the server for the progress of the upload.

    The unique X-Progress-ID is also sent to the delegate at this time within fileFieldViewDidSubmit(fileFieldView, result).

    TODO: generate a universally (between clients) unique id and allow this to be set externally

    @returns {String} the unique identifier sent as X-Progress-ID with the upload request
   */
  submitForm: function() {
    // Create the results capturing iframe
    this._createIframe();

    var uuid = "";
    for (var i = 0; i < 24; i++) {
      uuid += Math.floor(Math.random() * 16);
    }

    var del = this.get('delegate') ? this.get('delegate') : this;
    this.invokeDelegateMethod(del, 'fileFieldViewWillSubmit', this);

    // Update the form action
    this._form.set('action', this.get('formAction'));
    
    // Update any hidden fields
    var hiddenInputs = this.get('hiddenInputs');
    if (!SC.empty(hiddenInputs)) {
      for (var i = 0, e = hiddenInputs.get('length'); i < e; i++) {
        this.updateHiddenFieldValue(hiddenInputs.objectAt(i).key, hiddenInputs.objectAt(i).value);
      }
    }

    // Complete a run loop so that the form target and action are updated before the form is submitted
    SC.RunLoop.begin();
    // Set the target of our form to be this iFrame
    this._form.set('target', this._iframe.$()[0].name);
    // Generate a new unique id, so that the same form could be submitted  twice
    this._form.set('uuid', uuid);
    // TODO: does this value get used by any one? this._form.xProgressIDField.set('uuid', uuid);
    SC.RunLoop.end();

    // Monitor the onload event of the iframe when the upload completes
    SC.Event.add(this._iframe.$()[0], "load", this, this._iframeLoad);

    this._form.$()[0].submit();

    // disable ourselves while uploading
    this.set('isEnabled', NO);

    this.invokeLast(function() {
      this.invokeDelegateMethod(del, 'fileFieldViewDidSubmit', this, uuid);
    });

    return uuid;
  },

  delegate: null,

  didCreateLayer: function() {
    // Create the form (and iframe and input(s))
    this._createForm();
  },

  /** SC.View **/

  willDestroyLayer: function() {
    var idx = this.get('numberOfFiles'),
    input;
    while (--idx >= 0) {
      if (this._inputs) {
        input = this._inputs[idx];
        SC.Event.remove(input, 'mousedown', this, this._mouseDownInInput);
        // TODO: [publickeating] is it necessary to unregister for the following?
        SC.Event.remove(input, 'mouseup', this, this._mouseUpInInput);
        SC.Event.remove(input, 'mouseout', this, this._mouseOutOfInput);
      }
    }

    this._inputs = null;
    this.removeAllChildren();
  },

  reset: function() {
    var button = this._buttons[0],
        label = this._labels[0];

    this._form.$()[0].reset();

    // TODO: remove or clear all additional buttons and inputs
    button.set('title', this.get('buttonTitle'));
    label.set('value', '');
  },

  _inputChange: function(evt) {
    var input = this._inputs[evt.context],
    button = this._buttons[evt.context],
    label = this._labels[evt.context],
    values = this._values;

    // Initialize the values array if necessary
    if (!values) { values = this._values = []; }

    // Store the value
    var value = input.$().val(),
    previousValue = values[evt.context];

    // Scrub "C:\fakepath" from value. Some browsers (notably IE and Chrome) use this to mask the
    // actual path to the file for security reasons.  More here:
    // http://acidmartin.wordpress.com/2009/06/09/the-mystery-of-cfakepath-unveiled/
    if (SC.typeOf(value) === SC.T_STRING && value.indexOf("C:\\fakepath\\") === 0) {
      value = value.slice("C:\\fakepath\\".length);
    }

    values[evt.context] = value;

    var del = this.get('delegate') ? this.get('delegate') : this;
    this.invokeDelegateMethod(del, 'fileFieldValueDidChange', this, value, previousValue);

    SC.RunLoop.begin();
    if (this.get('displaysSelectedFilename')) { label.set('value', value); }
    if (this.get('fileSelectedButtonTitle')) { button.set('title', this.get('fileSelectedButtonTitle')); }
    SC.RunLoop.end();

    // Determine how many values are actually set
    var count = 0;
    for (var i = values.length - 1; i >= 0; i--) {
      count += SC.empty(values[i]) ? 0 : 1;
    }

    if ((this.get('numberOfFiles') > this._inputs.length) && this.get('isProgressive') && (this._inputs.length === count)) {
      // Insert another input for a progressive field if we haven't reached our limit and if there are no unset inputs
      this._createInput();
    } else if (this.get('autoSubmit')) {
      // Check for actual set values (beware using length of array because setting the last value alone will make the length equal to numberOfFiles)
      if (count === this.get('numberOfFiles')) {
        // Autosubmit if we have a full (matching numberOfFiles) array of values and the delegate allows it
        if (this.invokeDelegateMethod(del, 'fileFieldViewShouldSubmit', this)) { this.submitForm(); }
      }
    }
  },

  _mouseDownInInput: function(evt) {
    // Register for mouseup & mouseout events only if we got mousedown.  This prevents unnecessary events, particularly mouseout events
    var input = this._inputs[evt.context];

    SC.Event.add(input.$()[0], "mouseup", this, this._mouseUpInInput, evt.context);
    SC.Event.add(input.$()[0], "mouseout", this, this._mouseOutOfInput, evt.context);

    var button = this._buttons[evt.context];
    SC.RunLoop.begin();
    button.set('isActive', YES);
    SC.RunLoop.end();

    // Disable the input if the delegate won't allow it to open
    var del = this.get('delegate') ? this.get('delegate') : this;

    if (!this.invokeDelegateMethod(del, 'fileFieldViewShouldOpenFileSelect', this)) {
      input.$()[0].disabled = YES;
    }
  },

  _mouseUpInInput: function(evt) {
    // Unregister for mouseup & mouseout events
    var input = this._inputs[evt.context];
    SC.Event.remove(input.$()[0], 'mouseup', this, this._mouseUpInInput);
    SC.Event.remove(input.$()[0], 'mouseout', this, this._mouseOutOfInput);

    var button = this._buttons[evt.context];
    SC.RunLoop.begin();
    button.set('isActive', NO);
    SC.RunLoop.end();

    this.invokeLast(function() {
      var del = this.get('delegate') ? this.get('delegate') : this;
      this.invokeDelegateMethod(del, 'fileFieldViewDidOpenFileSelect', this);
    });
  },

  _mouseOutOfInput: function(evt) {
    // Unregister for mouseup & mouseout events
    var input = this._inputs[evt.context];
    SC.Event.remove(input.$()[0], 'mouseup', this, this._mouseUpInInput);
    SC.Event.remove(input.$()[0], 'mouseout', this, this._mouseOutOfInput);

    var button = this._buttons[evt.context];
    SC.RunLoop.begin();
    button.set('isActive', NO);
    SC.RunLoop.end();
  },

  _iframeLoad: function(evt) {
    var result = null;
    if (this._iframe.$()[0].contentWindow) { // Iframe body content for IE & Chrome
      if (this._iframe.$()[0].contentWindow.document.body.firstChild.innerHTML) {
        result = this._iframe.$()[0].contentWindow.document.body.firstChild.innerHTML;
      } else {
        // Chrome doesn't seem to have anything in innerHTML, but data gives us what we want
        result = this._iframe.$()[0].contentWindow.document.body.firstChild.data;
      }
    } else if (this._iframe.$()[0].contentDocument) { // Iframe body content for other browsers
      result = this._iframe.$()[0].contentDocument.body.firstChild.innerHTML;
    } else {
      throw 'Unable to retrieve file upload return value. Unknown iframe DOM structure.';
    }

    try {
      result = JSON.parse(result);
    } catch(err) {
      // Unable to parse the result
      console.error('Result:');
      console.dirxml(this._iframe.$()[0]);
      throw('Unable to parse file upload return value.\n\n' + err);
    }

    var del = this.get('delegate') ? this.get('delegate') : this;
    this.invokeDelegateMethod(del, 'fileFieldViewDidComplete', this, result);

    // re-enable ourselves
    this.set('isEnabled', YES);

    // Throw away the results frame (but pass on something)
    this.invokeLast(function() {
      SC.Event.remove(this._iframe.$()[0], 'load', this, this._iframeLoad);
      this.removeChild(this._iframe);
      this._iframe = null;
    });
  },

  _createIframe: function() {
    var iframe;

    iframe = SC.View.create({
      tagName: 'iframe',

      classNames: 'sc-file-field-iframe'.w(),

      layout: {
        height: 1,
        width: 1
      },

      displayProperties: 'name'.w(),

      render: function(context, firstTime) {
        var attributes = {
          name: SC.guidFor(this),
          src: 'about:blank',
          border: 0
        };
        context.attr(attributes);
        sc_super();
      }
    });

    // Complete a run loop so that the iframe exists before being referenced
    SC.RunLoop.begin();
    this.appendChild(iframe);
    this["_iframe"] = iframe;
    SC.RunLoop.end();
  },

  _createForm: function() {
    var form;

    form = SC.View.create({
      tagName: 'form',

      uuid: '',

      action: this.get('formAction'),

      target: '',

      classNames: 'sc-file-field-form'.w(),

      displayProperties: 'target action uuid'.w(),

      render: function(context, firstTime) {
        var attributes = {
          // TODO: remove specific name
          name: 'pictureForm',
          method: 'post',
          action: "%@?X-Progress-ID=%@".fmt(this.get('action'), this.get('uuid')),
          enctype: 'multipart/form-data',
          target: this.get('target')
        };
        context.attr(attributes);
        sc_super();
      },

      willDestroyLayer: function() {
        this.removeAllChildren();
      }

      // TODO: apparently this has no use in any of the upload progress modules
      // childViews: 'xProgressIDField'.w(),
      //
      // xProgressIDField: SC.View.design({
      //   tagName: 'input',
      //
      //   uuid: '',
      //
      //   displayProperties: 'uuid'.w(),
      //
      //   render: function(context, firstTime) {
      //     var attributes = {
      //       name: 'X-Progress-ID',
      //       value: this.get('uuid')
      //     };
      //     context.attr(attributes);
      //     if (firstTime) context.attr('type', 'hidden');
      //
      //     sc_super();
      //   }
      // })
    });

    this.appendChild(form);
    this["_form"] = form;

    // Create the default input(s)
    if (this.get('isProgressive')) { // Start with a single input
      this._createInput();
    } else {
      var idx = this.get('numberOfFiles');
      while (--idx >= 0) {
        this._createInput();
      }
    }
  },

  _createInput: function() {
    var button, controlSize,
    frame,
    label, input, form = this._form,
    layout = this.get('layout'),
    inputs = this._inputs,
    buttons = this._buttons,
    labels = this._labels;

    // Initialize arrays if necessary
    if (!inputs) { inputs = this._inputs = []; }
    if (!buttons) { buttons = this._buttons = []; }
    if (!labels) { labels = this._labels = []; }

    // Used to determine top offset for each childView
    var currentNumberOfInputs = this._inputs.length;

    button = SC.ButtonView.create({
      layout: {
        top: currentNumberOfInputs * (24 + this.BOTTOM_PADDING),
        height: this.get('buttonHeight'),
        width: this.get('buttonWidth')
      },
      classNames: 'sc-file-field-button-view'.w(),
      title: this.get('buttonTitle'),
      themeName: this.get('buttonThemeName'),
      controlSize: this.get('controlSize'),
      escapeHTML: this.get('escapeHTML'),
      isEnabledBinding: SC.Binding.oneWay('*parentView.isEnabled')
    });
    this.insertBefore(button, form);
    buttons.push(button);

    label = SC.LabelView.create({
      layout: {
        top: currentNumberOfInputs * (24 + this.BOTTOM_PADDING),
        height: this.get('buttonHeight'),
        left: this.get('buttonWidth') + 5
      },
      classNames: 'sc-file-field-label-view'.w(),
      value: this.get('emptyText'),
      escapeHTML: this.get('escapeHTML')
    });
    this.insertBefore(label, form);
    labels.push(label);

    // Add any hidden fields into the form
    var hiddenInputs = this.get('hiddenInputs');
    if (!SC.empty(hiddenInputs)) {
      var hiddenField = null;
      for (var i = 0, e = hiddenInputs.get('length'); i < e; i++) {
        form.appendChild(
          SC.FileFieldHiddenInputView.create({
            name: hiddenInputs.objectAt(i).key,
            value: hiddenInputs.objectAt(i).value
          })
        );
      }
    }

    frame = this.getPath('parentView.frame');

    // Add the input.  Note that the input is positioned so that the button portion is the only clickable part (for IE)
    input = SC.View.create(SC.Control, {
      useStaticLayout: YES,
      tagName: 'input',
      name: this.get('inputName'),
      currentNumberOfInputs: currentNumberOfInputs,
      // layout: {
      //   // left: 0,
      //   // "auto"
      //   // width: frame.width * 4, // The CSS font-size should already make it big
      //   right: -10,
      //   top: currentNumberOfInputs * (24 + this.BOTTOM_PADDING),
      //   height: this.get('buttonHeight')
      // },

      classNames: 'sc-file-field-input-view'.w(),
      isEnabledBinding: SC.Binding.oneWay('*parentView.parentView.isEnabled'),

      acceptsFirstResponder: function() {
        return YES;
      },

      render: function(context, firstTime) {
        var currentNumberOfInputs = this.get('currentNumberOfInputs'),
            height,
            top,
            parentView = this.get('parentView');

        if (firstTime) {
          context.attr('type', 'file').attr('name', this.get('name')).attr('multiple', this.get('numberOfFiles') > 1);

          height = parentView.get('buttonHeight');
          top = currentNumberOfInputs * (24 + parentView.BOTTOM_PADDING);
          context.addStyle({ 'top': top, 'height': height });
        }
      },

      // This helper gets us isEnabled functionality from the SC.Control mixin
      $input: function() {
        return this.$();
       }
    });
    form.appendChild(input);
    inputs.push(input);

    SC.RunLoop.begin().end();

    // Register for mousedown so that we can visually activate our button
    SC.Event.add(input.$()[0], "mousedown", this, this._mouseDownInInput, currentNumberOfInputs);
    SC.Event.add(input.$()[0], "change", this, this._inputChange, currentNumberOfInputs);

    //  Resize the parentview to fit
    layout.height = ((currentNumberOfInputs + 1) * 24) + (currentNumberOfInputs * this.BOTTOM_PADDING);
    this.set('layout', layout);

    // TODO: why doesn't the observer get this all the time
    this.layoutDidChange();
  },

  updateHiddenFieldValue: function(name, value) {
    // Complete a run loop so that the form's view layer is updated before the form is submitted
    SC.RunLoop.begin();

    var viewLayer = this._form.get('_view_layer'), found = 0;
    for (var i = 0, e = viewLayer.length; i < e; i++) {
      if (viewLayer[i].name === name) {
        viewLayer[i].value = value;
        found = 1;
        break;
      }
    }
    
    // Add if not found
    if (found === 0) {
      this._form.appendChild(
        SC.FileFieldHiddenInputView.create({
          name: name,
          value: value
        })
      );
    }    
    
    SC.RunLoop.end();
  },

  acceptsFirstResponder: function() {
    return this.get('isEnabled');
  }.property('isEnabled'),

  BOTTOM_PADDING: 8,

  /** Own FileFieldViewDelegate methods */
  fileFieldViewShouldOpenFileSelect: function(fileFieldView) {
    return YES;
  },

  fileFieldViewDidOpenFileSelect: function(fileFieldView) {},

  fileFieldValueDidChange: function(fileFieldView, value, previousValue) {},

  fileFieldViewShouldSubmit: function(fileFieldView) {
    return YES;
  },

  fileFieldViewWillSubmit: function(fileFieldView) {},

  fileFieldViewDidSubmit: function(fileFieldView, uuid) {},

  fileFieldViewDidComplete: function(fileFieldView, result) {}

});
