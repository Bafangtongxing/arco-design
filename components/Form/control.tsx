import React, { Component, isValidElement, ReactElement } from 'react';
import isEqualWith from 'lodash/isEqualWith';
import set from 'lodash/set';
import get from 'lodash/get';
import { FormControlProps, FieldError, FormItemContextProps, KeyType } from './interface';
import { FormItemContext } from './context';
import { isArray, isFunction, isNullOrUndefined } from '../_util/is';
import warn from '../_util/warning';
import IconExclamationCircleFill from '../../icon/react-icon/IconExclamationCircleFill';
import IconCloseCircleFill from '../../icon/react-icon/IconCloseCircleFill';
import IconCheckCircleFill from '../../icon/react-icon/IconCheckCircleFill';
import IconLoading from '../../icon/react-icon/IconLoading';
import { NotifyType, StoreChangeInfo } from './store';
import classNames from '../_util/classNames';
import { isSyntheticEvent, schemaValidate, isFieldMatch, ID_SUFFIX } from './utils';

export default class Control<
  FormData = any,
  FieldValue = FormData[keyof FormData],
  FieldKey extends KeyType = keyof FormData
> extends Component<FormControlProps<FormData, FieldValue, FieldKey>> {
  static defaultProps = {
    trigger: 'onChange',
    triggerPropName: 'value',
  };

  static isFormControl = true;

  static contextType = FormItemContext;

  context: FormItemContextProps<FormData, FieldValue, FieldKey>;

  private errors: FieldError<FieldValue> = null;

  private warnings: React.ReactNode[] = null;

  private isDestroyed = false;

  private touched: boolean;

  // 保存 props.children 或函数类型 props.children() 的返回值
  private childrenElement: React.ReactNode = null;

  private removeRegisterField: () => void;

  constructor(
    props: FormControlProps<FormData, FieldValue, FieldKey>,
    context: FormItemContextProps<FormData, FieldValue, FieldKey>
  ) {
    super(props);
    if ('initialValue' in props && this.hasFieldProps()) {
      const innerMethods = context.store.getInnerMethods(true);
      innerMethods.innerSetInitialValue(props.field, props.initialValue);
    }
  }

  componentDidMount() {
    const { store } = this.context;
    if (store) {
      const innerMethods = store.getInnerMethods(true);
      this.removeRegisterField = innerMethods.registerField(this);
    }
    this.isDestroyed = false;
  }

  componentDidUpdate(prevProps) {
    // key 未改变，但 field 改变了，则需要把绑定在之前 prevProps.field 上的错误状态调整到 props.field
    // 一般会把 field 直接作为 control 的 key，他们会同步变动，不会触发此逻辑
    // 在 FormList 下，`FormItem` 顺序会被改变，为了保证校验状态被保留，key 不会改变但 field 和字段顺序有关
    if (
      prevProps.field !== this.props.field &&
      this.props._key &&
      prevProps._key === this.props._key
    ) {
      this.updateFormItem();
      this.clearFormItemError(prevProps.field);
    }
  }

  componentWillUnmount() {
    this.removeRegisterField && this.removeRegisterField();

    this.removeRegisterField = null;
    this.clearFormItemError();
    this.isDestroyed = true;
  }

  getErrors = (): FieldError<FieldValue> | null => {
    return this.errors;
  };

  isTouched = (): boolean => {
    return this.touched;
  };

  public hasFieldProps = (): boolean => {
    return !!this.props.field;
  };

  private clearFormItemError = (field = this.props.field) => {
    // destroy errors
    const { updateFormItem } = this.context;
    updateFormItem && updateFormItem(field as string, { errors: null, warnings: null });
  };

  private updateFormItem = () => {
    if (this.isDestroyed) return;
    this.forceUpdate();
    const { updateFormItem } = this.context;
    updateFormItem &&
      updateFormItem(this.props.field as string, {
        errors: this.errors,
        warnings: this.warnings,
      });
  };

  public onStoreChange = (type: NotifyType, info: StoreChangeInfo<FieldKey> & { current: any }) => {
    const fields = isArray(info.field) ? info.field : [info.field];
    const { field, shouldUpdate, dependencies } = this.props;

    // isInner: the value is changed by innerSetValue
    const shouldUpdateItem = (extra?: { isInner?: boolean; isFormList?: boolean }) => {
      if (dependencies && shouldUpdate) {
        warn(true, '`shouldUpdate` of the `Form.Item` will be ignored.');
      }
      if (dependencies) {
        if (
          isArray(dependencies) ||
          (dependencies as string[]).some((depField) => isFieldMatch(depField, fields))
        ) {
          if (this.isTouched()) {
            this.validateField();
          }
        }
      } else if (shouldUpdate) {
        let shouldRender = false;
        if (isFunction(shouldUpdate)) {
          shouldRender = shouldUpdate(info.prev, info.current, {
            field: info.field,
            ...extra,
          });
        } else {
          shouldRender = !isEqualWith(info.prev, info.current);
        }
        if (shouldRender) {
          this.updateFormItem();
        }
      }
    };

    switch (type) {
      case 'reset':
        this.touched = false;
        this.errors = null;
        this.warnings = null;
        // https://github.com/arco-design/arco-design/issues/1460
        if (dependencies || shouldUpdate) {
          shouldUpdateItem();
        } else {
          // TODO
          // Keep the previous behavior, removed in the next major release
          this.updateFormItem();
        }
        break;
      case 'innerSetValue':
        if (isFieldMatch(field, fields)) {
          this.touched = true;
          this.updateFormItem();
          return;
        }
        shouldUpdateItem({
          isInner: true,
          isFormList: info.isFormList,
        });
        break;
      case 'setFieldValue':
        if (isFieldMatch(field, fields)) {
          this.touched = true;
          if (info.data && 'touched' in info.data) {
            this.touched = info.data.touched;
          }
          if (info.data && 'warnings' in info.data) {
            this.warnings = isNullOrUndefined(info.data.warnings)
              ? []
              : [].concat(info.data.warnings);
          }
          if (info.data && 'errors' in info.data) {
            this.errors = info.data.errors;
          } else if (!isEqualWith(get(info.prev, field), get(info.current, field))) {
            this.errors = null;
          }
          this.updateFormItem();
          return;
        }
        shouldUpdateItem();
        break;
      default:
        break;
    }
  };

  innerSetFieldValue = (field: FieldKey, value: FieldValue) => {
    if (!field) return;
    const { store } = this.context;
    const methods = store.getInnerMethods(true);
    methods.innerSetFieldValue(field, value);

    const changedValue = {} as Partial<FormData>;
    set(changedValue, field, value);

    this.props.onValuesChange &&
      this.props.onValuesChange(changedValue, {
        ...store.getFieldsValue(),
      });
  };

  /**
   *
   * @param triggerType the value of validateTrigger.
   * @returns
   */
  validateField = (
    triggerType?: string
  ): Promise<{
    error: FieldError<FieldValue> | null;
    value: FieldValue;
    field: FieldKey;
  }> => {
    const { store, validateTrigger: ctxValidateTrigger, validateMessages } = this.context;
    const { field, rules, validateTrigger } = this.props;
    const value = store.getFieldValue(field);

    const _rules = !triggerType
      ? rules
      : (rules || []).filter((rule) => {
          const triggers = [].concat(rule.validateTrigger || validateTrigger || ctxValidateTrigger);
          return triggers.indexOf(triggerType) > -1;
        });
    if (_rules && _rules.length && field) {
      return schemaValidate(field, value, _rules, validateMessages).then(({ error, warning }) => {
        this.errors = error ? error[field] : null;
        this.warnings = warning || null;
        this.updateFormItem();
        return Promise.resolve({ error, value, field });
      });
    }
    if (this.errors) {
      this.errors = null;
      this.warnings = null;
      this.updateFormItem();
    }
    return Promise.resolve({ error: null, value, field });
  };

  /**
   * 收集rules里的validateTrigger字段
   */
  getValidateTrigger(): string[] {
    const _validateTrigger =
      this.props.validateTrigger || this.context.validateTrigger || 'onChange';
    const rules = this.props.rules || [];

    let result: string[] = [];
    rules.map((item) => {
      result = result.concat(item.validateTrigger || _validateTrigger);
    });
    return Array.from(new Set(result));
  }

  // 每次 render 都会作为 onChange 传递给 children，需要保证引用地址不变
  // 所以 handleTrigger 需要声明在类上，并且直接作为 children.props.onChange
  handleTrigger = (_value, ...args) => {
    const children = (this.childrenElement || this.props.children) as React.ReactNode;
    const { store } = this.context;
    const { field, trigger, normalize, getValueFromEvent } = this.props;

    const value = isFunction(getValueFromEvent) ? getValueFromEvent(_value, ...args) : _value;
    let normalizeValue = value;
    // break if value is instance of SyntheticEvent, 'cos value is missing
    if (isSyntheticEvent(value)) {
      warn(
        true,
        'changed value missed, please check whether extra elements is outta input/select controled by Form.Item'
      );
      value.stopPropagation();
      return;
    }
    if (typeof normalize === 'function') {
      normalizeValue = normalize(value, store.getFieldValue(field), {
        ...store.getFieldsValue(),
      });
    }
    this.touched = true;
    this.innerSetFieldValue(field, normalizeValue);

    this.validateField(trigger);
    if (isValidElement(children) && children.props && children.props[trigger as string]) {
      children.props[trigger as string](normalizeValue, ...args);
    }
  };

  renderControl(children: React.ReactNode, id) {
    const {
      field,
      trigger = 'onChange',
      triggerPropName = 'value',
      validateStatus,
      formatter,
    } = this.props;
    const { store, disabled: ctxDisabled } = this.context;
    const disabled = 'disabled' in this.props ? this.props.disabled : ctxDisabled;
    const child = React.Children.only(children) as ReactElement;
    const childProps: any = {
      // used by label
      id: classNames(child.props?.id || { [`${id}${ID_SUFFIX}`]: id }),
    };

    this.getValidateTrigger().forEach((vt) => {
      childProps[vt] = (e) => {
        this.validateField(vt);
        child.props[vt] && child.props[vt](e);
      };
    });

    childProps[trigger] = this.handleTrigger;

    if (disabled !== undefined) {
      childProps.disabled = disabled;
    }
    let _value = store.getFieldValue(field);

    if (isFunction(formatter)) {
      _value = formatter(_value);
    }

    childProps[triggerPropName] = _value;
    if (!validateStatus && this.errors) {
      childProps.error = true;
    }

    return React.cloneElement(child, childProps);
  }

  getChild = () => {
    const { children } = this.props;
    const { store } = this.context;
    let child = children;
    if (isFunction(children)) {
      child = children(store.getFields(), {
        ...store,
      });
    }
    this.childrenElement = child;
    return child;
  };

  render() {
    const { noStyle, field, isFormList, hasFeedback } = this.props;
    const validateStatus = this.props.validateStatus || (this.errors ? 'error' : '');
    const { prefixCls, getFormElementId } = this.context;
    let child = this.getChild();
    const id = this.hasFieldProps() ? getFormElementId(field) : undefined;
    if (this.hasFieldProps() && !isFormList && React.Children.count(child) === 1) {
      child = this.renderControl(child, id);
    }

    if (noStyle) {
      return child;
    }
    return (
      <div className={`${prefixCls}-item-control-wrapper`}>
        <div className={`${prefixCls}-item-control`} id={id}>
          <div className={`${prefixCls}-item-control-children`}>
            {child}

            {validateStatus && hasFeedback && (
              <div className={`${prefixCls}-item-feedback`}>
                {validateStatus === 'warning' && <IconExclamationCircleFill />}
                {validateStatus === 'success' && <IconCheckCircleFill />}
                {validateStatus === 'error' && <IconCloseCircleFill />}
                {validateStatus === 'validating' && <IconLoading />}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
