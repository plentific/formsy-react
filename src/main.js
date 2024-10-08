var PropTypes = require('prop-types');
var React = global.React || require('react');
var createReactClass = require('create-react-class');
var Formsy = {};
var validationRules = require('./validationRules.js');
var formDataToObject = require('form-data-to-object');
var utils = require('./utils.js');
var Mixin = require('./Mixin.js');
var HOC = require('./HOC.js');
var Decorator = require('./Decorator.js');
var options = {};
var emptyArray = [];

Formsy.Mixin = Mixin;
Formsy.HOC = HOC;
Formsy.Decorator = Decorator;

Formsy.defaults = function (passedOptions) {
  options = passedOptions;
};

Formsy.addValidationRule = function (name, func) {
  validationRules[name] = func;
};

Formsy.Form = createReactClass({
  displayName: 'Formsy',
  getInitialState: function () {
    return {
      isValid: true,
      isSubmitting: false,
      canChange: false
    };
  },
  getDefaultProps: function () {
    return {
      onSuccess: function () {},
      onError: function () {},
      onSubmit: function () {},
      onValidSubmit: function () {},
      onInvalidSubmit: function () {},
      onValid: function () {},
      onInvalid: function () {},
      onChange: function () {},
      validationErrors: null,
      preventExternalInvalidation: false
    };
  },

  childContextTypes: {
    formsy: PropTypes.object
  },
  getChildContext: function () {
    return {
      formsy: {
        attachToForm: this.attachToForm,
        detachFromForm: this.detachFromForm,
        validate: this.validate,
        isFormDisabled: this.isFormDisabled,
        isValidValue: (component, value) => {
          return this.runValidation(component, value).then(info => info.isValid);
        }
      }
    }
  },

  // Add a map to store the inputs of the form, a model to store
  // the values of the form and register child inputs
  UNSAFE_componentWillMount: function () {
    this.inputs = [];
    this.canSetState = true;
    this.cachedValues = {};
  },

  componentDidMount: function () {
    this.validateForm();
  },

  componentWillUnmount () {
    this.canSetState = false
  },

  componentWillUpdate: function () {
    // Keep a reference to input names before form updates,
    // to check if inputs has changed after render
    this.prevInputNames = this.inputs.map(component => component.props.name);
  },

  componentDidUpdate: function () {

    if (this.props.validationErrors && typeof this.props.validationErrors === 'object' && Object.keys(this.props.validationErrors).length > 0) {
      this.setInputValidationErrors(this.props.validationErrors);
    }

    var newInputNames = this.inputs.map(component => component.props.name);
    if (utils.arraysDiffer(this.prevInputNames, newInputNames)) {
      this.validateForm();
    }

  },

  // Allow resetting to specified data
  reset: function (data) {
    this.setFormPristine(true);
    this.resetModel(data);
  },

  // Update model, submit to url prop and send the model
  submit: function (event) {

    event && event.preventDefault();

    // Trigger form as not pristine.
    // If any inputs have not been touched yet this will make them dirty
    // so validation becomes visible (if based on isPristine)
    this.setFormPristine(false);
    var model = this.getModel();
    this.props.onSubmit(model, this.resetModel, this.updateInputsWithError);
    this.state.isValid ? this.props.onValidSubmit(model, this.resetModel, this.updateInputsWithError) : this.props.onInvalidSubmit(model, this.resetModel, this.updateInputsWithError);

  },

  componentIsAttached (component) {
    return this.inputs.indexOf(component) >= 0
  },

  componentSetState (component, state, cb) {
    if (this.componentIsAttached(component)) {
      component.setState(state, cb)
    } else {
      cb()
    }
  },

  formSetState (state, cb) {
    if (this.canSetState) {
      this.setState(state, cb)
    }
  },

  mapModel: function (model) {

    if (this.props.mapping) {
      return this.props.mapping(model)
    } else {
      return formDataToObject.toObj(Object.keys(model).reduce((mappedModel, key) => {

        var keyArray = key.split('.');
        var base = mappedModel;
        while (keyArray.length) {
          var currentKey = keyArray.shift();
          base = (base[currentKey] = keyArray.length ? base[currentKey] || {} : model[key]);
        }

        return mappedModel;

      }, {}));
    }
  },

  getModel: function () {
    var currentValues = this.getCurrentValues();
    return this.mapModel(currentValues);
  },

  // Reset each key in the model to the original / initial / specified value
  resetModel: function (data) {
    this.inputs.forEach(component => {
      var name = component.props.name;
      if (data && data.hasOwnProperty(name)) {
        component.setValue(data[name]);
      } else {
        component.resetValue();
      }
    });
    this.validateForm();
  },

  setInputValidationErrors: function (errors) {
    this.inputs.forEach(component => {
      var name = component.props.name;
      if (!(name in errors)) {
        return
      }
      var state = {
        _isValid: errors[name] === null,
        _validationError: typeof errors[name] === 'string' ? [errors[name]] : errors[name],
      };
      this.componentSetState(component, state);
    });
  },

  // Checks if the values have changed from their initial value
  isChanged: function() {
    return !utils.isSame(this.getPristineValues(), this.getCurrentValues());
  },

   getPristineValues: function() {
    return this.inputs.reduce((data, component) => {
      var name = component.props.name;
      data[name] = component.props.value;
      return data;
    }, {});
  },

  // Go through errors from server and grab the components
  // stored in the inputs map. Change their state to invalid
  // and set the serverError message
  updateInputsWithError: function (errors) {
    Object.keys(errors).forEach((name, index) => {
      var component = utils.find(this.inputs, component => component.props.name === name);
      if (!component) {
        throw new Error('You are trying to update an input that does not exist. ' +
          'Verify errors object with input names. ' + JSON.stringify(errors));
      }
      var state = {
        _isValid: this.props.preventExternalInvalidation || false,
        _externalError: typeof errors[name] === 'string' ? [errors[name]] : errors[name]
      };
      this.componentSetState(component, state);
    });
  },

  isFormDisabled: function () {
    return this.props.disabled;
  },

  getCurrentValues: function () {
    return this.inputs.reduce((data, component) => {
      var name = component.props.name;
      data[name] = component.state._value;
      return data;
    }, {});
  },

  setFormPristine: function (isPristine) {
    this.formSetState({
      _formSubmitted: !isPristine
    });

    // Iterate through each component and set it as pristine
    // or "dirty".
    this.inputs.forEach((component, index) => {
      this.componentSetState(component, {
        _formSubmitted: !isPristine,
        _isPristine: isPristine
      });
    });
  },

  // Use the binded values and the actual input value to
  // validate the input and set its state. Then check the
  // state of the form itself
  validate: function (component) {

    // Trigger onChange
    if (this.state.canChange) {
      this.props.onChange(this.getModel(), this.isChanged());
    }

    this.runValidation(component)
    .then(validation => {
      if (!validation) {
        return
      }
      // Run through the validations, split them up and call
      // the validator IF there is a value or it is required
      this.componentSetState(component, {
        _isValid: validation.isValid,
        _isRequired: validation.isRequired,
        _validationError: validation.error,
        _externalError: null
      }, this.validateForm);
    })
  },

  // Checks validation on current value or a passed value
  runValidation: function (component, value) {

    var currentValues = this.getCurrentValues();
    var validationErrors = component.props.validationErrors;
    var validationError = component.props.validationError;
    value = arguments.length === 2 ? value : component.state._value;

    this.cachedValues[component.props.name] = value

    if (Object.keys(component._validations).length === 0 && Object.keys(component._requiredValidations).length === 0) {
      return Promise.resolve()
    }

    return Promise.all([
      this.runRules(value, currentValues, component._validations),
      this.runRules(value, currentValues, component._requiredValidations)
    ])
    .then(([validationResults, requiredResults]) => {
      if (this.cachedValues[component.props.name] !== value) {
        return
      }

      let validateComponent = Promise.resolve()

      // the component defines an explicit validate function
      if (typeof component.validate === "function") {
        validateComponent = Promise.resolve(component.validate()).then(validated => {
          validationResults.failed =  validated ? [] : ['failed'];
        })
      }

      return validateComponent.then(() => {
        if (this.inputs.indexOf(component) < 0) {
          return;
        }

        var isRequired = Object.keys(component._requiredValidations).length ? !!requiredResults.success.length : false;
        var isValid = !validationResults.failed.length && !(this.props.validationErrors && this.props.validationErrors[component.props.name]);

        return {
          isRequired: isRequired,
          isValid: isRequired ? false : isValid,
          error: (function () {

            if (isValid && !isRequired) {
              return emptyArray;
            }

            if (validationResults.errors.length) {
              return validationResults.errors;
            }

            if (this.props.validationErrors && this.props.validationErrors[component.props.name]) {
              return typeof this.props.validationErrors[component.props.name] === 'string' ? [this.props.validationErrors[component.props.name]] : this.props.validationErrors[component.props.name];
            }

            if (isRequired) {
              var error = validationErrors[requiredResults.success[0]];
              return error ? [error] : null;
            }

            if (validationResults.failed.length) {
              return validationResults.failed.map(function(failed) {
                return validationErrors[failed] ? validationErrors[failed] : validationError;
              }).filter(function(x, pos, arr) {
                // Remove duplicates
                return arr.indexOf(x) === pos;
              });
            }

          }.call(this))
        };
      })
    })
  },

  runRules: function (value, currentValues, validations) {

    var results = {
      errors: [],
      failed: [],
      success: []
    };

    return Promise.all(Object.keys(validations).map(function (validationMethod) {

      if (validationRules[validationMethod] && typeof validations[validationMethod] === 'function') {
        throw new Error('Formsy does not allow you to override default validations: ' + validationMethod);
      }

      if (!validationRules[validationMethod] && typeof validations[validationMethod] !== 'function') {
        throw new Error('Formsy does not have the validation rule: ' + validationMethod);
      }

      if (typeof validations[validationMethod] === 'function') {
        return Promise.resolve(validations[validationMethod](currentValues, value))
        .then(validation => {
          if (typeof validation === 'string') {
            results.errors.push(validation);
            results.failed.push(validationMethod);
          } else if (!validation) {
            results.failed.push(validationMethod);
          }
          return;
        })

      } else if (typeof validations[validationMethod] !== 'function') {
        return Promise.resolve(validationRules[validationMethod](currentValues, value, validations[validationMethod]))
        .then(validation => {
          if (typeof validation === 'string') {
            results.errors.push(validation);
            results.failed.push(validationMethod);
          } else if (!validation) {
            results.failed.push(validationMethod);
          } else {
            results.success.push(validationMethod);
          }
          return;
        })
      }

      return results.success.push(validationMethod);

    }))
    .then(() => results)
  },

  // Validate the form by going through all child input components
  // and check their state
  validateForm: function () {

    // We need a callback as we are validating all inputs again. This will
    // run when the last component has set its state
    var onValidationComplete = function () {
      var allIsValid = this.inputs.every(component => {
        return component.state._isValid;
      });

      this.formSetState({
        isValid: allIsValid
      });

      if (allIsValid) {
        this.props.onValid();
      } else {
        this.props.onInvalid();
      }

      // Tell the form that it can start to trigger change events
      this.formSetState({
        canChange: true
      });

    }.bind(this);

    // Run validation again in case affected by other inputs. The
    // last component validated will run the onValidationComplete callback
    Promise.all(this.inputs.map((component, index) => {
      this.runValidation(component)
      .then(validation => {
        if (!validation) {
          return
        }
        if (validation.isValid && component.state._externalError) {
          validation.isValid = false;
        }
        this.componentSetState(component, {
          _isValid: validation.isValid,
          _isRequired: validation.isRequired,
          _validationError: validation.error,
          _externalError: !validation.isValid && component.state._externalError ? component.state._externalError : null
        });
      })
    }))
    .then(() => {
      if (this.canSetState) {
        onValidationComplete()
      }
    });

    // If there are no inputs, set state where form is ready to trigger
    // change event. New inputs might be added later
    if (!this.inputs.length) {
      this.formSetState({
        canChange: true
      });
    }
  },

  // Method put on each input component to register
  // itself to the form
  attachToForm: function (component) {

    if (this.inputs.indexOf(component) === -1) {
      this.inputs.push(component);
    }

    this.validate(component);
  },

  // Method put on each input component to unregister
  // itself from the form
  detachFromForm: function (component) {
    var componentPos = this.inputs.indexOf(component);

    if (componentPos !== -1) {
      this.inputs = this.inputs.slice(0, componentPos)
        .concat(this.inputs.slice(componentPos + 1));
    }

    this.validateForm();
  },
  render: function () {
    var {
      mapping,
      validationErrors,
      onSubmit,
      onValid,
      onValidSubmit,
      onInvalid,
      onInvalidSubmit,
      onChange,
      reset,
      preventExternalInvalidation,
      onSuccess,
      onError,
      ...nonFormsyProps
    } = this.props;

    return (
      <form {...nonFormsyProps} onSubmit={this.submit}>
        {this.props.children}
      </form>
    );

  }
});

if (!global.exports && !global.module && (!global.define || !global.define.amd)) {
  global.Formsy = Formsy;
}

module.exports = Formsy;
