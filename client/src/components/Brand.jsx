/** The Yaar wordmark used on the home screen and inner page headers. */
export function Brand({ withTagline = false }) {
  return (
    <span className="brand">
      <span className="brand__mark" aria-hidden="true">
        Y
      </span>
      <span>
        <span className="brand__name">Yaar</span>
        {withTagline ? <span className="brand__tag">Someone to talk to, anytime.</span> : null}
      </span>
    </span>
  );
}

export default Brand;
